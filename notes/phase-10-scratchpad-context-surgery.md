# Phase 10 — Scratchpad (Chain-of-Thought) + Context Surgery

> **Status:** Part 1 (Scratchpad / Chain-of-Thought) complete and committed. Part 2
> (Context Surgery — surgical log queries + log_detective rework) IN PROGRESS — this
> note will be appended when it lands.
>
> **Why this note is split:** Phase 10 has two independent sub-steps. Per the commit-cadence
> rule (commit logical sub-steps, don't let a long phase pile up — the lesson from the
> Phase 8/9 entanglement), Scratchpad is committed and documented on its own before
> Context Surgery starts.

---

# PART 1 — Scratchpad / Chain-of-Thought ✅

## 1. WHY

Before this, every agent's structured-output schema put the *answer* fields first
(`failure_category`, `root_cause`, …). The model committed to a conclusion in its very
first output tokens, then rationalized. We force reasoning to happen *before* the answer
by making a `thinking_process` field the **first** field in every agent schema.

## 2. WHAT — file by file

```
src/sentinel/agents/
├── state.py          ← thinking_process added FIRST to TriagerFindings, InvestigatorFindings,
│                        RootCauseFindings, CritiqueResult, PostMortemReport
└── investigators.py  ← thinking_process added FIRST to _InvestigatorOutput
```

The field, identical everywhere:
```python
thinking_process: str = Field(
    description="Step-by-step reasoning over the evidence. Think BEFORE the conclusion fields."
)
```

## 3. HOW it works — the real mechanism (interview-grade)

**Name:** Chain-of-Thought (Wei et al., 2022, Google). The "reasoning into a field" form is
the **scratchpad** (Nye et al., 2021). Ours is *structurally-enforced* CoT — reasoning is
the first schema field, so it's mandatory, not requested.

Why it works, mechanistically:

1. **Autoregression = fixed compute per token.** An LLM emits one token at a time, each
   from a single fixed-depth forward pass. It cannot think ahead or revise. The only way it
   performs multi-step reasoning is to *spend tokens on it* — each reasoning token is extra
   serial computation it then conditions on.
2. **Answer-first = zero working computation.** If `failure_category` is first, the model
   must output the conclusion in its first tokens with no intermediate steps. For multi-hop
   inference (log + metric + topology evidence → root cause) that single pass is
   insufficient; it pattern-matches a plausible answer instead of deriving it.
3. **Reasoning-first = externalized working memory.** Put `thinking_process` first and those
   tokens enter the context the answer attends to: the answer is now
   `P(answer | evidence, its_own_reasoning)`, not `P(answer | evidence)`.
4. **Formal backing (not just empirical):** a fixed-depth transformer is limited to a
   bounded circuit class per forward pass (Merrill & Sabharwal 2023; Feng et al. 2023 on
   CoT expressivity). Emitting intermediate tokens lets it simulate deeper serial
   computation. Soundbite: *"CoT converts a fixed-compute forward pass into variable-length
   serial computation — it raises the model's effective reasoning depth."*
5. **Structured-output nuance most people miss:** the model fills JSON fields in *schema
   declaration order*. Asking "think step by step" in the prompt does nothing if the schema
   emits the answer field first. Reasoning field **first** = CoT structurally guaranteed.
   Reasoning field last = reasoning wasted (answer already generated).

**Honest caveat (signals real understanding):** the stated reasoning is not guaranteed to
be the model's true causal reasoning — the faithfulness problem (Turpin et al. 2023). It
still improves *accuracy* even when imperfectly faithful, but the scratchpad is not a
guaranteed audit trail. Also: more tokens = more latency/cost; overkill for trivial lookups.

## 4. KEY CONCEPTS

- **CoT / scratchpad** — externalize reasoning before the answer; raises effective compute.
- **Schema field order is load-bearing** with structured output — order = generation order.
- **LLM-facing schema vs stored model** — `_InvestigatorOutput` (LLM fills) vs
  `InvestigatorFindings` (stored; has code-owned `agent`). Kept separate on purpose so the
  LLM never picks its own identity. Both carry `thinking_process` so they map cleanly and
  every agent is *consistent* (the user's call — consistency beat the "strip it for
  investigators only" idea, which would've made investigators the lone exception).

## 5. MISTAKES & GOTCHAS

| Mistake | Fix / resolution |
|---|---|
| `thinking_process` is required, no default → fear it breaks hand-built models | Ran full suite: 8 passed, 3 deselected (integration). No code hand-builds these schemas → safe. |
| `InvestigatorFindings(**raw.model_dump())` would reject unknown `thinking_process` | Resolved by adding `thinking_process` to `InvestigatorFindings` too (consistent with all other agents persisting it) — NOT by `exclude=`. The exclude argument only held if scratchpad were stripped everywhere; it isn't, so excluding only for investigators would be the inconsistency. |
| Tempting to merge `_InvestigatorOutput`/`InvestigatorFindings` into one model | Don't — `agent` is code-owned; a merged LLM-filled model could hallucinate its own identity. |

## 6. INTERVIEW Q&A

**Q: Why does putting a reasoning field first improve accuracy — isn't it just "ask it to think"?**
> Structured output is generated in schema-field order. Reasoning-first means the reasoning
> tokens are physically generated before any answer token and become context the answer is
> conditioned on. CoT works because autoregressive models have fixed compute per token;
> intermediate tokens are extra serial computation. Field order makes that mandatory; a
> prompt request with answer-first schema does nothing.

**Q: Is the model's stated reasoning trustworthy?**
> It improves accuracy but isn't guaranteed faithful to the true causal computation (Turpin
> 2023). Use it to improve outcomes, not as a guaranteed audit log.

**Q: Why two investigator models instead of one?**
> `agent` is set by code, not the LLM — a merged model would let the LLM declare its own
> identity. Separation is a deliberate boundary (LLM-facing DTO vs stored domain model).

## 7. COMMANDS

```powershell
.venv\Scripts\python.exe -m pytest -q          # 8 passed, 3 deselected — no breakage
```

## 8. WHAT'S NEXT (Part 2, this phase)

Context Surgery: surgical `DataSource` log queries (`get_error_traces`,
`search_logs_regex`) replacing the blind 20-line dump, then `log_detective` reworked to
query narrowly (code-driven, not yet an LLM tool-loop — that autonomous-querying version
is Phase 14). Real-output verification of *both* scratchpad and surgery happens at the
Phase 10 end-to-end test.

---

# PART 2 — Context Surgery ✅

## 1. WHY

`log_detective` was doing `get_logs(count=20)` — a blind dump. In the Phase 8 live run its
evidence was mostly `GET /route 500` access-log noise with the real `fatal: ...` signal
buried in it. A human SRE greps for errors; they don't read 20 random lines. We give the
node surgical queries so it sees signal, not noise.

## 2. WHAT — file by file

```
src/sentinel/datasource/
├── base.py   ← +2 abstractmethods: get_error_traces, search_logs_regex
├── lab.py    ← client-side filtering (lab has no query API — must fetch then filter)
└── gcp.py    ← server-side filtering via Cloud Logging filter strings + _run_query_logs reuse
src/sentinel/agents/
└── investigators.py ← log_detective: error-traces-first with widen-on-empty fallback
```

## 3. HOW it works

### 3a. Lab vs GCP filter — deliberately divergent (NOT shared)

The obvious DRY move (a shared filter helper) is **wrong** here:
- **Lab** has no query API → must `get_logs` then filter in Python (client-side).
- **GCP** filters **server-side** via Cloud Logging filter strings — only matching lines
  cross the network. That's the entire surgical win; copying Lab's fetch-then-filter into
  GCP would re-introduce the data-dump it exists to kill.

Lesson: *DRY is a means, not an end. Deduplicating code that should legitimately diverge is
over-abstraction.* The similarity was coincidental.

### 3b. Cloud Logging filter syntax (GCP)

```
base:    resource.type="cloud_run_revision" resource.labels.service_name="{svc}"
errors:  base + ' jsonPayload.level="ERROR"'
regex:   base + f' jsonPayload.message=~"{pattern}"'
```
Filter on `jsonPayload.level` (what our services emit), NOT the built-in `severity` — our
JSON has no `severity` key so Cloud Run leaves entry severity at default; the real level
lives in the structured payload. `_run_query_logs(service, filter_str, count)` is the single
sync core (the to_thread'd `list_entries` + entry→dict mapping), reused by all three GCP
log methods — intra-class DRY (the Phase 9 extract-parameterize lesson), since *here* the
behaviour genuinely is the same.

### 3c. Graceful degradation — the load-bearing detail

`memory_leak` and `latency_spike` emit **no ERROR logs** (they show in metrics, not logs).
So `get_error_traces` returns `[]` for them. `log_detective` therefore narrows first, and
**widens if empty**:

```python
error_logs = await ds.get_error_traces(service, count=10)
if error_logs:
    logs, logs_source = error_logs, "ERROR LOGS ONLY"
else:
    logs = await ds.get_logs(service, count=20)
    logs_source = "ALL LOGS (NO RECENT ERROR LOGS FOUND)"
```

The `logs_source` label is passed into the prompt so the LLM reasons about *provenance* —
for a latency_spike the *absence* of error logs is itself diagnostic. Surgery that finds
nothing must widen, not go blind. (The LLM-driven version of "widen if empty" — where the
model itself decides to re-query — is Phase 14. Here it's deterministic code.)

## 4. PROOF (live, real GCP — Phase 10 end-to-end)

crash_loop on order-service, full pipeline against real Cloud Run + Cloud Logging:

- **Scratchpad:** all 6 agents produced real multi-step `thinking_process` before their
  conclusions (triager derived crash_loop from alert+metrics+logs; critic reasoned the
  evidence chain before `approved=True`).
- **Surgery:** `log_detective evidence count=10 | INFO/access-noise lines=0` — every line a
  `fatal: segmentation fault` ERROR. Phase 8's run had access-log noise here; now pure
  signal.
- **Bonus:** log_detective's scratchpad *noticed* the evidence spanned two time periods
  (today's logs + retained Phase 8 logs in Cloud Logging) and reasoned about it — the
  deliberation CoT is meant to force.

## 5. MISTAKES & GOTCHAS

| Mistake | Fix |
|---|---|
| Invented Cloud Logging syntax `json.Payload("INFO">="ERROR")` | Real syntax: `jsonPayload.level="ERROR"` (read the docs, don't guess) |
| Missing separator → `..."svc"jsonPayload...` | Trailing space after base clause before `+ filter_str` |
| Copied Lab's `count*5` over-fetch into GCP | GCP filters server-side — just `count` |
| Reused `regex` param to hold the result list | Rename to `matches` — works by luck, bug magnet |
| Stray `from itertools import count` shadowing the param | Delete it — killed F401 + 3×F811 at once |
| Missing type annotations on new GCP methods | strict mypy/ruff ANN — annotate fully |

## 6. INTERVIEW Q&A

**Q: You had near-identical filter logic in two classes — why didn't you share it?**
> The similarity was coincidental. Lab must filter client-side (no query API); GCP must
> filter server-side (that's the performance win). A shared helper would force GCP into the
> wrong implementation to satisfy DRY. Deduplicating code that should diverge is
> over-abstraction.

**Q: What happens when the surgical query finds nothing?**
> It widens. `log_detective` queries ERROR traces first; if empty (silent failures like
> memory_leak), it falls back to the general log tail and labels the source so the model
> treats "no errors" as diagnostic. Narrowing without a widen path makes the agent blind.

**Q: Is this the agentic "the LLM picks its own queries" pattern?**
> No — that's Phase 14 (sub-graph/tool-loop). Phase 10 is deterministic code-driven
> narrowing. Build and prove the scalpels first; hand them to the LLM to wield itself later.

## 7. WHAT'S NEXT

Phase 11 — Eval harness: a labeled incident set + accuracy/MTTR metrics. The thing that
makes this *measurable and credible*, not just impressive.
