# Phase 16b — Sandbox Verifier (Differential Test Check)

> **Status:** Wired and verified — graph compiles (16 nodes), 13 tests pass.
> The full-graph code-patch e2e lives in 16c (which inserts promote + an
> outcome for a verified patch); 16b's deliverable is the verification
> *gate itself* — the node, the differential check, the bounded retry loop.
>
> **Deliverable:** A deterministic, independent verification of a Claude
> Code patch BEFORE it can be promoted to prod. The verdict catches three
> failure modes — broken fix, fake test, broken verification — and feeds
> a bounded retry loop on the graph.

---

## 1. WHY

After 16a, Claude Code produces a committed patch in a sandbox repo. The
question 16b answers: **how do we know the patch is good without
trusting the LLM's own report?**

The naive answer ("re-run the tests CC wrote, green = good") fails: CC
wrote BOTH the fix AND the tests, so re-running them isn't independent.
A hallucinated `assert True` would pass on broken code AND fixed code,
and re-running it proves nothing.

16b's verification is the gate between "CC produced something" and
"this thing is trustworthy enough for a human to consider promoting" —
exactly where asymmetric safety needs to fire.

---

## 2. WHAT — file by file

```
src/sentinel/agents/code_fixer.py
  + run_tests(cwd, paths=None) -> (bool, str)
        pytest in `cwd` (via `sys.executable -m settings.test_command`).
        Returns a verdict; NEVER raises on a failing test (test failure
        is normal data, not a fault — contrast `_git` which raises).
        paths=None → whole suite (pytest auto-discovers test_*.py).
  + _is_test_file(path) -> bool
        path-convention test classifier (test_*.py, *_test.py, tests/).
  + sandbox_verifier_node(state)
        the differential check — see §3.
  + after_sandbox_verifier_routing(state)
        verified → finalize ; failed + attempts<5 → executor (retry) ;
        exhausted → finalize. Bound = len(state["patch_reports"]).
  + _MAX_PATCH_ATTEMPTS = 5

src/sentinel/agents/state.py
  + class PatchVerification(BaseModel):
        ok: bool
        description: str    # on failure: MODE first (FIX FAILED / FAKE TEST / ...)
  + IncidentState.patch_verification: Annotated[list[PatchVerification], add]

src/sentinel/agents/executor.py
  ~ after_executor_routing — adds the branch:
        if state.get("patch_reports"):  return "sandbox_verifier"
    Code patch was attempted → its differential verification owns the
    next step. Even a failed code-fix routes here (sandbox_verifier
    detects empty commit_sha → CODE FIX FAILED → retry path).

src/sentinel/agents/graph.py
  + register "sandbox_verifier" node
  + add_conditional_edges("sandbox_verifier", after_sandbox_verifier_routing)

src/sentinel/config.py
  + test_command: str = "pytest"
    (Removes the hardcode; default fits Sentinel's Python-FastAPI target
    services. Polyglot auto-detect — out of scope.)
```

---

## 3. HOW — the differential check (the headline idea)

A genuine regression test has one defining property:

> **It fails on the broken code and passes on the fixed code.**

A fake test (`assert True`, or a test that doesn't exercise the bug)
passes on both. So the verification is:

```
Run CC's tests at the FIX commit       → must PASS  (the fix works)
Run CC's tests at the PARENT commit    → must FAIL  (the test is real)

verified  ⇔  pass-on-fix  AND  fail-on-parent.
```

A test that passes against the unfixed code is fake — **reject the
patch.** You never trusted CC; you *proved* the test catches the bug by
watching it fail on the broken code.

### 3a. The git mechanism — why `git stash` is wrong

The natural-language way to express it is "un-apply the fix." The wrong
mechanism is `git stash`: stash operates on **uncommitted** working-tree
changes. CC has already *committed* — the working tree is clean. Stash
would be a no-op.

The right mechanism: **checkout the parent commit, then overlay the
fix-commit's test files** so you run the new tests against the old code:

```
git checkout --force <fix_sha>        # whole tree to the fix — pass-on-fix run
run_tests(cwd)                        # expect passed=True

git checkout --force <fix_sha>^       # whole tree to the parent (unfixed)
git checkout <fix_sha> -- <test files>  # overlay JUST the changed tests
run_tests(cwd)                        # expect passed=False  (fail-on-parent)

git checkout --force <fix_sha>        # restore the clean promotable state
```

`git checkout <commit> -- <path>` is the surgical tool: it copies *just
those paths* from that commit into the working tree without moving
HEAD. That's how you compose "parent code + fix's tests."

### 3b. Identifying the test files — git, not a folder convention

You don't trust CC to put tests in a `tests/` folder, because git tells
you the truth: `git show --name-only <sha>` lists every file CC changed.
Filter by path convention (`test_*.py`, `*_test.py`, `tests/`,
`/tests/`). That's `_is_test_file`. Even if CC dropped tests at the
repo root (like the dummy `test_app.py`), the convention catches them.

And — for the pass-on-fix run — you don't even need a file list:
pytest auto-discovers every `test_*.py` from the cwd downward.

### 3c. Three failure modes, named first in `description`

The verdict's `description` field is what 16c will feed back to CC on a
retry. So it has to tell CC *what* to fix — code or test. The
convention: name the mode first.

| Mode | Means | Retry instruction |
|---|---|---|
| `FIX FAILED` | suite is red with the patch | "your fix doesn't work — re-examine" |
| `FAKE TEST` | suite passes even on unfixed code | "your test doesn't catch the bug — rewrite" |
| `CODE FIX FAILED` | CC never produced a commit (empty commit_sha) | "CC failed to commit — try again" |
| `VERIFICATION ERROR` | git/pytest plumbing blew up | "verification harness broke — investigate" |

A single `description: str` carries this — but the convention
(mode-first) is the discipline. A small `failure_reason` enum would be
the structured form; not needed yet.

### 3d. Deterministic, not LLM (asymmetric safety, again)

The sandbox verifier has **no LLM** in the loop. It's a gate inside a
bounded retry, exactly like the Phase 12 prod verifier. Same reasoning:
LLM judgment of "loop or stop" is non-deterministic and costly per
iteration; whatever judgment is needed (which tests to run, what counts
as a fake test) is solved deterministically by *git + pytest*. Any LLM
judgment that's needed about the *next* attempt happens in CC on the
retry, with the failure context fed in (16c).

### 3e. Two verifications, two targets — clarified once

The recurring confusion (it bit me too — I wrote a long correction):

| | **Sandbox verifier** (NEW, 16b) | **Prod verifier** (Phase 12, unchanged) |
|---|---|---|
| Question | "Is the patch good?" | "Did prod actually recover?" |
| When | After CC commits, BEFORE promote | AFTER promote |
| Target | the sandbox container/dir | prod (lab / GCP) |
| Method | differential test check (this phase) | health + metrics + error logs |

They aren't the same thing pointed at different targets — they're
*different verifications* at different points in the timeline. Don't
repoint Phase 12's verifier; add this one.

### 3f. The retry loop — visible at the graph level

The 16b retry is a real graph cycle:

```
executor → sandbox_verifier → (ok)  finalize
                            → (fail, attempts<5)  executor   (re-runs code_fixer; CC session resumes)
                            → (exhausted)         finalize
```

Bounded by `len(state["patch_reports"]) < _MAX_PATCH_ATTEMPTS=5`. The
`patch_reports` array is `Annotated[list[PatchReport], add]` — every
executor run that ran code_fixer appends one. The array length **is**
the attempt counter (no separate field).

The loop is implemented as **conditional edges**, not a Python `while`
inside the node. Same architectural choice as Phase 12's plan↔verify
loop: visible, checkpointable, bounded by a state counter, replayable.

### 3g. Sub-agent special-cased in the executor — keeping execute_step pure

`code_fixer` is a multi-turn Claude Code agent — conceptually unlike a
one-shot API call (`heal`, `rollback`). The wrong move is to make
`execute_step` return mixed types (`StepResult` for most actions, a
`dict` for the code-patch one). I tried that path and it produced a
half-implemented dual-output that broke everywhere.

The right move: **`executor_node` special-cases `APPLY_CODE_PATCH`** —
calls `code_fixer` directly, collects `patch_reports` separately, still
builds one `StepResult` for the loop. `execute_step` stays a pure
single-return-type dispatcher. Single-responsibility for the inner
function; the special case lives in the *caller*.

---

## 4. MISTAKES & GOTCHAS

| Mistake | Lesson |
|---|---|
| `git stash` to "un-apply the fix" | stash is uncommitted-changes-only; CC already committed → working tree clean. Use `git checkout` to move between commits, not stash |
| `py test_app.py` as the test runner | runs the file as a *script* — no test runner invokes the `test_*` functions, exit 0 even for broken tests. Use `sys.executable -m pytest` |
| One subprocess per test file in a Python loop | pytest **is** the loop — `pytest a.py b.py` runs both and reports all failures in one invocation |
| `raise` on a failing test | test failure is *normal data* for a verifier, not a fault. Return a verdict (contrast `_git` which raises on a git error) |
| `len(state.get("patch_reports", None))` | `.get` default of `None` → `len(None)` crash. `state.get(k) or []` collapses missing/None/empty to `[]` |
| `is not None` to guard `[-1]` | `[]` passes `is not None` → `[-1]` IndexError. Use truthiness |
| Half-implemented dual-output: `execute_step` returns `StepResult` for 6 arms but a dict for one | a function must have ONE return type. Special-case in the caller, not the dispatcher |
| Inverted `ok` logic (`ok=True if "could not be produced" in summary`) | that's the error message — sets ok=True on FAILURE. Use a deterministic signal: `ok=bool(commit_sha)` |
| `{"key": v, var: v}` — unquoted key | the variable's *value* becomes the key. String keys need quotes |
| Tests-folder trust — "we'll instruct CC to use `tests/`" | git already tells you what CC changed. `git show --name-only` + path-convention filter; don't depend on a folder promise |
| Hardcoded `"pytest"` in `run_tests` | pull the runner from config — `settings.test_command`. Python-centric default is fine for Sentinel's target services; polyglot is a future feature |
| Stating routing preconditions as if obvious | sometimes worth saying explicitly anyway — the assumption that sandbox_verifier only runs post-code-patch isn't enforced by the node itself, the graph router enforces it |

---

## 5. INTERVIEW Q&A

**Q: An AI wrote the fix AND the tests. How do you trust the tests?**
> You don't. You run the new tests against the *unfixed* code — they
> must FAIL there. A test that passes on broken code is fake. That's
> the differential check: pass-on-fix AND fail-on-parent. You never
> trusted the agent's report; you proved the test catches the bug by
> watching it fail on the broken code.

**Q: Why isn't `git stash` the right tool to "un-apply" the fix?**
> Stash operates on uncommitted working-tree changes. The fix is a
> *commit* — the working tree is clean. Stash would be a no-op. The
> right tool is `git checkout <parent>` to move the whole tree to the
> pre-fix state, then `git checkout <fix> -- <test files>` to overlay
> just the new tests onto the parent's code.

**Q: Why deterministic verification — no LLM in the verify loop?**
> Asymmetric safety. An LLM judging "loop or stop" inside a bounded
> retry is non-deterministic and costly per iteration; whatever
> judgment is required (which tests to run, what counts as a fake
> test) is solved deterministically by git + pytest. Judgment that
> genuinely needs the LLM happens in the *retry*, where CC reads the
> deterministic verdict's `description` and reattempts.

**Q: How do you bound the retry loop?**
> `len(state["patch_reports"]) < _MAX_PATCH_ATTEMPTS`. The array length
> *is* the attempt counter — every executor run that ran code_fixer
> appends one PatchReport (the `add` reducer accumulates). No separate
> counter, no race conditions, the bound is read from state.

**Q: Why is sandbox_verifier its own graph node, not code inside the
executor?**
> Three reasons. (1) The retry loop wants to be visible at the graph
> level — checkpointable, bounded by a state counter, replayable —
> exactly like Phase 12's executor↔verifier loop. A hidden `while`
> inside `executor_node` defeats that. (2) Single responsibility:
> executor *acts*, verifier *verifies* — Phase 12 already set that
> split, and the code-patch path should mirror it. (3) 16c's promote
> HITL needs to sit *after* the verdict; only a node has somewhere for
> downstream routing to attach.

**Q: A multi-step sub-agent has to slot into a step-iterating executor
expecting one StepResult per step — and it also produces a richer
artifact. How?**
> Don't make `execute_step` return mixed types (that's the bug). The
> caller (`executor_node`) special-cases the action: it drives the
> sub-agent directly, collects the rich artifact (`PatchReport`) into a
> separate list, and still builds the one `StepResult` the loop needs.
> The inner dispatcher stays pure; the caller absorbs the special
> case.

---

## 6. COMMANDS

```powershell
# graph compile-check + tests
.venv\Scripts\python.exe tests\_check_wiring.py
.venv\Scripts\python.exe -m pytest tests\ -q

# standalone code_fixer (16a's test still applies — sandbox_verifier
# runs against the sandbox code_fixer creates)
$env:SENTINEL_CC_DEBUG = "1"
$env:SENTINEL_GITHUB_PROD_LINK = "D:/projects/codefix-testrepo"
Remove-Item -Recurse -Force "$env:LOCALAPPDATA\Temp\sentinel-sandbox-inc_codefix_test" -ErrorAction SilentlyContinue
.venv\Scripts\python.exe tests\_check_codefixer.py
```

(No standalone sandbox_verifier test was added — the node will exercise
naturally in 16c's full-graph e2e once the promote tail exists.)

---

## 7. CARRIED FORWARD (deliberate — all 16c)

- **Outcome label.** A verified patch routes to `finalize` but
  `finalize_node` reads `state["verification"]` (the *prod* verifier),
  not `patch_verification` — so a verified patch finalizes as
  `EMPTY_PLAN_DEFECT`. Harmless to execution, wrong label. 16c fixes
  this when it adds promote + a proper outcome (a verified-pending-
  promote patch is not the same thing as RESOLVED).
- **Retry feedback.** On a retry the loop re-enters `executor` →
  `code_fixer` *resumes the CC session*, but `patch_code` doesn't yet
  fold the latest `patch_verification.description` into the prompt. So
  the retry is currently semi-blind. 16c should feed `FIX FAILED` /
  `FAKE TEST` back so CC knows what to fix.
- **Polyglot test command.** `test_command` config removes the
  literal hardcode; auto-detection (`pyproject.toml` → pytest,
  `go.mod` → `go test`, `package.json` → `npm test`) is a real
  feature but out of scope. Every target service Sentinel currently
  fixes is Python-FastAPI, so pytest is the right default.
- **Pre/post HEAD check.** `is_error` covers SDK failures, but a
  pre/post `git rev-parse HEAD` comparison would catch "CC said
  success but produced no commit." Currently `sandbox_verifier` would
  catch this via the empty-`commit_sha` CODE FIX FAILED branch, but a
  direct check would be sharper. Optional hardening.

---

## 8. WHAT'S NEXT

Phase 16c — **promote + validate-and-promote loop closure.** Concretely:
(1) decide the semantics of `RESOLVED` for code patches and add the
right `IncidentOutcome` value(s); (2) wire `patch_verification`
failure back into `code_fixer`'s retry prompt; (3) build the promote
step (push the sandbox commit into the prod repo — with attention to
the "git push to a checked-out branch is denied" trap, probably solved
via `git fetch` + `git merge --ff-only` from the prod side); (4) add
the promote HITL gate (human reviews the `PatchReport` + diff before
the promote runs). Then a full-graph e2e: incident → diagnosis → HITL →
code_fixer → sandbox_verifier → promote-HITL → promote → prod-verify →
finalize.
