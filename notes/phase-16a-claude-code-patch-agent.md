# Phase 16a — Claude Code SDK Patch-Generation Agent

> **Status:** Complete. The CodeFixer sub-agent is proven end-to-end against a
> dummy repo — Claude Code located a planted defect, fixed it, ran the tests
> green, git-stash-verified the test genuinely catches the bug, committed, and
> returned a `PatchReport` with a real commit SHA. Wired into the executor's
> `APPLY_CODE_PATCH` dispatch; graph compiles, all existing tests pass.
>
> **Deliverable:** Given a diagnosed code defect (investigator + RCA + plan),
> Sentinel hands it to a Claude Code SDK sub-agent running in an isolated git
> sandbox. CC navigates the repo, fixes the root cause, proves it with tests,
> and commits. Sentinel reads `commit_sha` + `files_touched` from git and the
> `summary` from CC's final text, assembling a `PatchReport`.
>
> **Why this is the turning point:** Phases 0–13 made Sentinel *diagnose* and
> do *operational* remediation (heal/restart/rollback). 16a is the first phase
> where Sentinel **fixes the actual bug in the code.**

---

## 1. WHY

Phase 16 is the final "real" layer of the roadmap. Phases 13a/13b were its
safety prerequisites (dual-track HITL, prompt-injection isolation). 16a is the
first of four 16-sub-phases:

- **16a** — patch generation (this phase): CC produces a real code fix.
- 16b — ephemeral Docker sandbox + verifier-against-sandbox.
- 16c — validate-and-promote loop (green → promote, red → re-patch, exhaust).
- 16d — Slack HITL surface.

16a's unit is *only* patch generation — no sandbox-vs-prod runtime, no
promotion. Get CC reliably producing a committed fix in an isolated workspace,
captured as a structured `PatchReport`. Everything else builds on that.

---

## 2. WHAT — file by file

```
src/sentinel/agents/
├── code_fixer.py   ← NEW. The CodeFixer sub-agent.
│     code_fixer(state)        — orchestrator: sandbox → sync → patch
│     create_sandbox_env(id)   — per-incident stable temp dir, reuse-if-exists
│     fetch_sync_code(cwd)     — git clone-or-pull into the sandbox
│     patch_code(state, cwd)   — build prompt, run SDK query() loop, assemble
│                                PatchReport (git for facts, CC text for prose)
│     _git(cwd, *args)         — asyncio subprocess wrapper for git
│     _CC_DEBUG / _open_trace / _format_cc_message / _cc_trace
│                              — opt-in SDK message tracer (SENTINEL_CC_DEBUG)
├── state.py        ← RemediationAction.APPLY_CODE_PATCH (+ in DANGEROUS_ACTIONS)
│                      PatchReport model
│                      patch_reports: Annotated[list[PatchReport], add]
├── executor.py     ← executor_node special-cases APPLY_CODE_PATCH → code_fixer;
│                      execute_step stays a pure StepResult dispatcher
└── config.py       ← github_prod_link setting

tests/_check_codefixer.py  ← NEW. Standalone harness — hand-built IncidentState,
                              real SDK call. Leading underscore → pytest skips.

D:\projects\codefix-testrepo  ← NEW, separate git repo. A tiny order-pricing
                              service with a planted KeyError + a failing test.
                              The "production repo" code_fixer clones.
```

---

## 3. HOW — the concepts that matter

### 3a. SDK over CLI subprocess
Three integration options existed: drive the `claude` CLI as a subprocess,
the **Claude Agent SDK**, or the raw Anthropic API with custom file tools.
Chose the **SDK** — programmatic, structured boundary, designed for exactly
this (orchestrating a CC-style agent loop), and billed against the Max plan.

### 3b. Git for facts, CC's text for prose
The single most important design principle of this phase. CC's `PatchReport`
has facts and prose:
- **Facts** (`commit_sha`, `files_touched`) — read **deterministically from
  git** after CC commits: `git rev-parse HEAD`, `git show --name-only HEAD`.
- **Prose** (`summary`) — taken from CC's natural final text
  (`result_message.result`).

Never ask the LLM to self-report what a deterministic system already knows
exactly. This is the same principle as the deterministic verifier (Phase 12)
and the deterministic `outcome` (Phase 12) — *structured fact over LLM
self-report*, applied a third time.

### 3c. The structured-output saga (the headline lesson)
First implementation used `output_format` / the SDK's `StructuredOutput` to get
a typed `_CodePatchOutput` back. It **failed**: `ResultMessage.subtype ==
error_max_structured_output_retries`. CC did the actual fix flawlessly, then
retried the structured report 5× and gave up.

Root cause — **two different mechanisms for "structured output":**

| | Constrained decoding | Validate-and-retry |
|---|---|---|
| Where | Plain chat API (`responseSchema`) — Sentinel's Gemini agents | Agent SDK `StructuredOutput` |
| How | Decoder is token-masked — invalid output is *impossible* | Model generates freely; SDK validates *after*; on fail, re-asks |
| Guarantee | Hard | Best-effort (the subtype is literally `..._retries`) |

In an agent loop the model freely calls many tools (Read/Grep/Bash/...); you
can't grammar-mask one tool's args mid-conversation — so the SDK necessarily
does generate-then-validate-then-retry. That is *softer by construction*, not
a bug. Our schema then walked into the soft spot: a fat `thinking_process`
field invited a 1,500-char essay → the model felt "done" → it kept omitting
`key_changes` (a list, redundant-feeling after the essay) → retry only
re-asks, it doesn't *force* — same omission 5×.

**The fix:** drop structured output entirely. Once 3b put the facts in git,
the *only* thing left for CC to "report" was a prose summary — and
`result_message.result` IS that, natively, with no schema that can fail.
**Structured output is for extraction tasks, not for agents that act.**

### 3d. `permission_mode=bypassPermissions`
`acceptEdits` auto-approves *file edits* and a few filesystem commands — but
NOT general Bash (`git commit`, `pytest`). An autonomous agent has no human to
answer a permission prompt, so any prompting mode → hang. `bypassPermissions`
never prompts. Safe here because CC runs in an **isolated sandbox** (a throwaway
clone) — the docs' "controlled environment" case. And deny rules still fire
under bypass, so `disallowed_tools=["Bash(git push *)"]` structurally prevents
CC from pushing — Sentinel owns promotion (16c).

### 3e. `max_budget_usd` — the real cost guard
A hard USD cap per CC run. The model can't exceed it — the SDK self-terminates
with `error_max_budget_usd`. This is the subscription protection; `max_turns`
is only a runaway-loop backstop. Set to $2 for the tiny dummy repo.

### 3f. Session resume — `cc_session_id` lives in `PatchReport`
The CC session ID is a **CC-specific artifact**, so it lives in `PatchReport`,
not the shared `IncidentState` — most incidents never touch CC; don't pollute
shared state with one node's implementation detail. On a retry, code_fixer
reads `patch_reports[-1].cc_session_id` and passes `resume=`. **Caveat from the
docs:** sessions are keyed by an encoded `cwd`, so resume only works if the
sandbox directory is *stable per incident* — which is why `create_sandbox_env`
uses a deterministic per-incident path, not a fresh `mkdtemp()`.

### 3g. Executor wiring — the dual-output problem
`APPLY_CODE_PATCH` produces *two* things: a `StepResult` (for the executor's
`executor_result` loop) and a `PatchReport` (for `patch_reports`). The wrong
fix is making `execute_step` return mixed types (`StepResult` for most actions,
a dict for this one) — a type-inconsistent function the caller can't handle.
The right fix: `executor_node` **special-cases** `APPLY_CODE_PATCH` — calls
`code_fixer` directly, collects `patch_reports`, builds the `StepResult` — and
`execute_step` stays a **pure single-return-type dispatcher**. Code-fix is a
multi-step sub-agent, conceptually unlike a one-shot API call; giving it its
own branch in `executor_node` is honest.

### 3h. `_git`, `subprocess`, `*args`
`asyncio.create_subprocess_exec("git", *args, cwd=..., stdout=PIPE,
stderr=PIPE)` — `exec` runs git directly (no shell → no quoting/injection).
`*args` *collects* extra positionals into a tuple in the `def`, *spreads* them
back to separate args in the call. Raises `RuntimeError` on non-zero exit so a
failed `rev-parse` fails loud instead of silently becoming an empty SHA.

### 3i. The opt-in SDK tracer
`SENTINEL_CC_DEBUG=1` streams every SDK message (tool calls, text, results, the
final `ResultMessage`) to the console and a per-run file under `data/cc-runs/`.
Off by default → `_open_trace` returns `None` → every trace call is a no-op.
This is what made the structured-output failure diagnosable — without it we'd
have seen only the cryptic final error, not the 5 `StructuredOutput` retries.

---

## 4. THE LIVE FINDING (standalone test, dummy repo)

`tests/_check_codefixer.py` against `D:\projects\codefix-testrepo` (a planted
`KeyError: 'discount'` in `calculate_total`, plus a failing test).

CC's run, observed via the tracer:
```
Glob **/app.py → Grep discount → Read app.py + test_app.py
Edit  order["discount"] → order.get("discount", 0.0)        ← correct root-cause fix
Bash  pytest → 2 passed
Bash  git stash → pytest (unfixed) → KeyError → git stash pop  ← self-verification
Bash  git add && git commit → b42db8f
final text: a Defect / Change / Proof summary
ResultMessage: subtype=success, num_turns=10, cost=$0.39
```

The standout: **CC stashed its own fix, re-ran the test against the *unfixed*
code to confirm it genuinely fails, then restored the fix.** That is CC
actively proving the test isn't trivial — a direct behavioural response to the
`CODE_FIXER_SYSTEM` rule *"a test that cannot fail proves nothing."* The system
prompt didn't just get read; it changed what the agent did.

The plain-text `summary` it produced (Defect / Change / Proof, ~1 KB) is
*richer* than the rigid `_CodePatchOutput` schema would ever have been —
further evidence that dropping structured output was the right call.

---

## 5. MISTAKES & GOTCHAS

| Mistake | Lesson |
|---|---|
| `output_format` / `StructuredOutput` for an agent's report | Agent-SDK structured output is validate-and-retry, not constrained decoding — soft by construction. Use it for extraction, not for agents that act |
| `output_format=_CodePatchOutput` (the Pydantic class) | The SDK wants `{"type": "json_schema", "schema": model.model_json_schema()}` — a dict, not the class |
| `acceptEdits` for an autonomous agent | It covers file edits, NOT general Bash (git/pytest) — the agent would hang on an unanswerable permission prompt. Use `bypassPermissions` in a sandbox |
| `**result_message` | The SDK `ResultMessage` is an object, not a dict — can't `**`-spread it; extract the field you want |
| `/tmp/sentinel-sandbox-...` hardcoded | Unix path; on Windows it resolves oddly. `os.path.join(tempfile.gettempdir(), ...)` |
| `random.randint(9999)` | `randint(a, b)` needs two args; and for security-relevant randomness use `secrets`, not `random` |
| `any(genexpr)` to build f-string text | `any` → a bool. To interpolate text you want `"\n".join(...)` — only `join` produces a string |
| `len(state.get(k, None))` | `.get` default of `None` → `len(None)` crash. `state.get(k) or []` collapses missing/None/empty to `[]` |
| `is not None` to guard `[-1]` | `[]` passes `is not None` → `[][-1]` IndexError. Use truthiness |
| Half-implemented dual output in `execute_step` | A function must have ONE return type. `StepResult` for 6 arms + a dict for one → the caller can't handle both. Special-case in the caller instead |
| Inverted `ok` logic (`ok=True if "could not be produced" in summary`) | That string is the *error* message — the check set ok=True on failure. Prefer a deterministic signal: `ok=bool(commit_sha)` |
| `{"key": v, var: v}` — unquoted dict key | `var:` uses the *variable's value* as the key. String keys need quotes |
| Changed `execute_step` signature, not the call site | Signature and every call must change together |

---

## 6. INTERVIEW Q&A

**Q: Why the Claude Agent SDK over driving the `claude` CLI as a subprocess?**
> Programmatic, structured control and a clean boundary. The SDK gives typed
> messages, options (permission mode, budget caps, session resume), and a
> message stream you can observe — versus parsing CLI stdout. For an agent
> that another system orchestrates, the SDK is the right seam.

**Q: Why read `commit_sha` and `files_touched` from git instead of having CC
report them?**
> They are facts git knows exactly. Asking an LLM to self-report a 40-char SHA
> is asking for a transcription error. `git rev-parse HEAD` and
> `git show --name-only HEAD` are deterministic and free. The LLM is left with
> exactly the one thing only it can produce — a prose summary. Structured fact
> over LLM self-report; the recurring principle.

**Q: Your structured output failed. Anthropic ships the feature — why?**
> Two different mechanisms hide behind the phrase "structured output."
> Constrained decoding (a plain chat API with a response schema) token-masks
> the decoder — invalid output is impossible. The Agent SDK's `StructuredOutput`
> is validate-and-retry: the model generates the tool args freely, the SDK
> validates afterward, and on mismatch it re-asks. The error subtype is
> literally `error_max_structured_output_retries` — retries only exist because
> there's no hard constraint. In an agent loop you can't grammar-mask one
> tool's arguments mid-conversation, so validate-and-retry is the necessary
> design — but it's best-effort. Our schema (a fat essay field + a
> redundant-feeling list) hit the soft spot. The fix wasn't to fight it: once
> git owned the facts, the only output left was a prose summary, and the
> result text already *is* that. Structured output is for extraction, not for
> agents that act.

**Q: Why `bypassPermissions`? Isn't that dangerous?**
> `acceptEdits` doesn't auto-approve general Bash — `git commit`, the test
> runner — and an autonomous agent has no human to answer a permission prompt,
> so any prompting mode hangs. `bypassPermissions` is the only no-prompt mode.
> It's safe because CC runs in an isolated throwaway sandbox — the docs' exact
> "controlled environment" use case. And deny rules still fire under bypass, so
> `disallowed_tools` blocks `git push` — CC commits locally; Sentinel owns
> promotion.

**Q: How do you stop a confused agent from burning the budget?**
> `max_budget_usd` — a hard USD cap; the SDK self-terminates at it with
> `error_max_budget_usd`. `max_turns` is a secondary runaway-loop backstop.
> The budget cap is the real money protection.

**Q: A multi-step sub-agent has to slot into a step-iterating executor that
expects one `StepResult` per step — and it also produces a richer artifact.
How?**
> Don't make the per-step dispatcher (`execute_step`) return mixed types — a
> function with two return types is the bug. Special-case the action in the
> *caller* (`executor_node`): it calls the sub-agent directly, collects the
> rich artifact into its own list, and still builds the one `StepResult` the
> loop needs. The dispatcher stays pure; the caller absorbs the special case.

---

## 7. COMMANDS

```powershell
# Install the SDK
uv add claude-agent-sdk

# Standalone CodeFixer test (real SDK call — costs money)
$env:SENTINEL_CC_DEBUG = "1"                       # verbose SDK trace
$env:SENTINEL_GITHUB_PROD_LINK = "D:/projects/codefix-testrepo"
Remove-Item -Recurse -Force "$env:LOCALAPPDATA\Temp\sentinel-sandbox-inc_codefix_test" -ErrorAction SilentlyContinue
.venv\Scripts\python.exe tests\_check_codefixer.py

# Compile-check the graph + run the suite
.venv\Scripts\python.exe tests\_check_wiring.py
.venv\Scripts\python.exe -m pytest tests\ -q
```

The dummy repo (`D:\projects\codefix-testrepo`) is a separate git repo — a
tiny order-pricing service with a planted `KeyError` and a failing test. It is
the stand-in "production repo" that `code_fixer` clones.

---

## 8. CARRIED FORWARD (deliberate)

- **Full-graph code-patch e2e** — a run where the planner emits
  `APPLY_CODE_PATCH` → HITL → executor → code_fixer can't *cleanly* complete
  until the verifier checks the **sandbox** (16b), not the lab service. 16a's
  proof is the standalone green run + correct wiring + compile + tests.
- **Docker sandbox** — 16a's "sandbox" is just a host temp dir + git clone.
  The throwaway Docker container that *runs* the patched code is 16b.
- **Telemetry fields** — `PatchReport.tokens_used / wall_time_seconds /
  tools_used` are defined but not yet populated from `result_message.usage`.
- **Commit-actually-happened check** — `is_error` covers SDK failures, but a
  pre/post `git rev-parse HEAD` comparison would also catch "CC said success
  but produced no commit." A 16c hardening.
- **`Co-Authored-By: Claude` trailer** — CC adds it to its sandbox commits.
  Kept deliberately — for an autonomous AI fixing production code it is honest
  provenance an reviewer benefits from. (Distinct from the no-trailer rule on
  Sentinel's *own* commits.)

---

## 9. WHAT'S NEXT

Phase 16b — **ephemeral Docker sandbox + verifier-against-sandbox.** Build a
throwaway Docker container from the patched repo at CC's commit, run it, point
the Phase 12 verifier spine at *that* container instead of the lab service.
Then 16c wires the green/red/exhaust validate-and-promote loop, and 16d adds
the Slack HITL surface.
