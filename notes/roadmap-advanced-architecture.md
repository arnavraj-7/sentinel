# Sentinel — Advanced Architecture Roadmap

> **Purpose:** This is the forward-looking spec. The `phase-NN-*.md` files document what's
> already built. This file documents what we WILL build to take Sentinel from "good
> multi-agent project" to "production-grade AI SRE system."
>
> Source: synthesized from the architecture review (2026-05-17) + Gemini consultation.
> Every item here is committed — we WILL implement all of it. Order is in section 4.
>
> **Status:** Phases 0-7 complete. This roadmap = Phases 8+.

---

## Deployed real services (Phase 7 output)

These replace the simulated lab. Cloud Run, us-central1, project `sentinel-496513`:

| Service | URL | Unique failure mode |
|---|---|---|
| api-gateway | https://api-gateway-717499257054.us-central1.run.app | (baseline 3 modes) |
| order-service | https://order-service-717499257054.us-central1.run.app | `high_error_rate` |
| inventory-service | https://inventory-service-717499257054.us-central1.run.app | `data_corruption` |

All three expose: `/health`, `/metrics`, `/sabotage`, `/heal`, `/route`.

---

## 1. Advanced Agent Orchestration ("Smart Engine" patterns)

How the multi-agent system routes logic and reasons — what separates this from a basic
LLM wrapper.

### 1a. Context Surgery (not data dumping)
Agents must NEVER dump thousands of raw log lines into state. Replace `get_all_logs()`-style
tools with investigative tools: `search_logs_by_regex()`, `filter_by_timeframe()`,
`get_error_traces()`. The agent narrows context to the relevant ~50 lines like a human
investigator would.
- **Where it plugs in:** `investigators.py` — `log_detective_node` currently pulls 20 lines
  blindly. Becomes a tool-using agent that queries selectively.

### 1b. The Scratchpad (hidden chain-of-thought)
Every Pydantic output schema gets a `thinking_process: str` field placed BEFORE the final
execution fields. Forces the model to reason through its logic before committing to an
action/output.
- **Where it plugs in:** `state.py` — add `thinking_process` to `_InvestigatorOutput`,
  `RootCauseFindings`, `CritiqueResult`, `TriagerFindings`.

### 1c. Sub-Graphs for complex nodes (micro-agents)
A complex node like Log Detective becomes its own localized LangGraph. It loops internally:
query → review → widen timeframe if empty → query again → synthesize → return clean summary
to the main Supervisor. The main graph sees one clean result, not the internal loop.
- **Where it plugs in:** `log_detective` and `root_cause_analyst` become compiled sub-graphs
  invoked as nodes in the parent graph.

### 1d. Semantic State Routing
Replace rigid if/else edges with a router that evaluates the semantic meaning of state.
E.g. state containing `"FATAL: connection pool"` → route to a specialized Database Profiler
node instead of the generic analyst.
- **Where it plugs in:** `supervisor.py` — currently a static category→agents dict. Add a
  semantic routing layer on top for specialized profiler nodes.

### 1e. Multi-Step Planning (Planner–Worker)
The Runbook Planner outputs a strict numbered array of remediation steps
(`[1. Rollback, 2. Restart, 3. Verify]`) — it does NOT execute. The Executor iterates the
array one step at a time, updating state on each step's success/failure.
- **Where it plugs in:** New `runbook_planner_node` before `executor_node`. Executor becomes
  a step-iterator, not a single `/heal` call.

---

## 2. Production Resilience (so the graph never crashes/hangs/bankrupts the budget)

### 2a. State Management & Context Trimming
LangGraph state grows every loop. Add a trimming node: when token count crosses a threshold,
summarize older investigative steps, drop raw tool outputs, keep synthesized facts + latest
messages.
- **Where it plugs in:** A `trim_state_node` invoked between revision loops in the
  analyst↔critic cycle.

### 2b. Structured Output Retry Loops
LLMs eventually emit malformed JSON / fail Pydantic validation. Wrap every LLM call in a
retry loop (`max_retries=3`): catch `ValidationError`, feed the exact error string back into
context, instruct the model to fix the schema, retry.
- **Where it plugs in:** A shared `structured_invoke()` helper wrapping every
  `_structured_llm.ainvoke()` call across all agent files.

### 2c. High-Availability Fallback Models
If the primary model 5xx's or hits a rate limit, failover seamlessly to a secondary model
(e.g. primary Gemini 2.5 Pro → fallback Gemini 2.5 Flash). The pipeline never freezes.
- **Where it plugs in:** Same shared `structured_invoke()` helper — chained model fallback.

### 2d. Strict Tool Execution Timeouts
Wrap every tool call in `asyncio.wait_for` (e.g. 10s). On timeout, catch and return to the
agent: `"Tool timed out. Abort this approach and try another."`
- **Where it plugs in:** Every `httpx`/tool call in investigators, triager, executor.

### 2e. Semantic Caching (alert dedup)
One outage = dozens of identical alerts. Redis cache at the Triager: if a new alert is ≥90%
semantically identical to one seen in the last 60s, group it with the active incident and
halt the graph to save compute.
- **Where it plugs in:** `triager_node` entry — semantic similarity check before any LLM call.

---

## 3. Execution Safety & Guardrails (protect infra from the AI itself)

### 3a. Dual-Track Tool Structure
Strictly separate `SafeTools` (read-only: `pytest`, `git status`, `read_file`) from
`DangerousTools` (write/destructive: `git revert`, `kubectl scale`, `claude_code_edit`).
Safe tools run autonomously. Any dangerous tool request triggers the `interrupt()` HITL gate.
- **Where it plugs in:** Executor tool registry + `executor.py` HITL gating.

### 3b. Defense Against Indirect Prompt Injection
Logs contain raw user input. A malicious payload (`admin"; DROP TABLE users; --` or embedded
"ignore previous instructions") must be treated as inert string data, never as instructions.
Sanitize + strictly delimit/isolate all log text injected into prompts.
- **Where it plugs in:** Every place log text enters a prompt — investigators, triager.
  Wrap log content in explicit delimiters + a system instruction that content between them
  is untrusted data.

### 3c. Self-Healing Verification Loops
After the Executor applies a fix, automatically run a verification step (`pytest` / hit
`/health`). If it fails, pipe the test output back to the LLM to self-correct. After 3
failed attempts, automatically `git revert` to leave the environment safe.
- **Where it plugs in:** New `verify_node` after `executor_node`, with a revert fallback path.

---

## 4. Implementation order (phases 8+)

Sequenced so each phase unblocks the next and the core demo story comes together fastest:

- **Phase 8 — Taxonomy + DataSource abstraction.** Reconcile `FailureCategory` with what
  real services emit (`high_error_rate`, `data_corruption`). Build a `DataSource` interface
  (lab impl + GCP Cloud Logging/Monitoring impl). Wire investigators to real Cloud Run URLs.
  *(In progress now — start with the taxonomy fix.)*
- **Phase 9 — Resilience core (2b, 2c, 2d).** Shared `structured_invoke()` with retry +
  schema-repair + model fallback + tool timeouts. Nothing else is safe to demo without this.
- **Phase 10 — Scratchpad + Context Surgery (1a, 1b).** Investigative log tools +
  `thinking_process` fields. Biggest single quality jump in reasoning.
- **Phase 11 — Eval harness.** Labeled incident set, accuracy metrics (classification,
  root-cause precision, revision count, MTTR). This makes it portfolio-grade and demo-able.
- **Phase 12 — Planner–Worker + Self-Healing Verification (1e, 3c).** Runbook planner,
  step-iterating executor, post-fix verification with auto-revert.
- **Phase 13 — Safety guardrails (3a, 3b).** Dual-track tools, prompt-injection isolation.
- **Phase 14 — Sub-graphs + Semantic Routing (1c, 1d).** Micro-agents, specialized
  profiler nodes.
- **Phase 15 — Semantic caching + context trimming (2e, 2a).** Redis dedup, state trimming.
- **Phase 16 — Claude Code real code-fix agent + Slack HITL.** The final "real" layer.
  **Ephemeral-sandbox validation (committed requirement):** CC generates a code patch →
  Sentinel spins up a throwaway sandbox (isolated Cloud Run revision / separate deploy) →
  applies the patch there → runs health + eval/tests *in the sandbox* → green ⇒ promote to
  prod; red ⇒ feed failure logs back to CC (max N) ⇒ else abandon/revert. This is the
  Phase 12 self-healing verify spine (verification / remediation_attempts / escalate)
  with "operational action" swapped for "CC patch + ephemeral env" — additive, not a
  rewrite. (Why Phase 12 must precede 16: the spine is built there.)

LangSmith tracing + cost/latency-per-incident telemetry: layered in starting Phase 9,
expanded through every subsequent phase.

---

## 5. Why this order (the reasoning)

1. **Phase 8 is blocking** — nothing reads from the real services yet, and there's an active
   schema mismatch (`high_error_rate`/`data_corruption` not in `FailureCategory`).
2. **Resilience before features** — adding sub-graphs/planners on top of a pipeline that
   crashes on the first rate-limit is building on sand. Free-tier Gemini WILL rate-limit.
3. **Eval harness early-ish** — once reasoning quality matters (post Scratchpad), we need to
   measure it. You can't tune what you can't score.
4. **Safety before real execution** — dual-track tools + injection defense MUST land before
   the Claude Code agent can touch real code/infra.
