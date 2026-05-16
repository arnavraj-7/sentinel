# Phase 4 — Root Cause Analyst + Critic (Reflection Loop)

> **Status:** Complete — analyst + critic running, reflection loop verified live.
>
> **Duration:** 1 session
>
> **Deliverable:** After the three parallel investigators finish, a Root Cause Analyst
> synthesizes their findings into one precise root cause. A Critic then reviews it and
> either approves (done) or rejects with specific feedback (loops back for revision).
> The graph can cycle up to `_MAX_REVISIONS` times before terminating regardless.

---

## 1. WHY this phase exists

The investigators produce three independent reports — log findings, metric findings, topology
findings. They don't talk to each other. Someone has to synthesize them into a single,
actionable root cause that an SRE can actually act on.

Then a second agent reviews that synthesis. Why? Because LLMs can produce confident-sounding
but vague output ("the service crashed"). The critic enforces specificity: the root cause must
name the exact failure mechanism, be supported by quoted evidence, and have a concrete fix.

This is the **reflection loop pattern** — one of the most valuable patterns in production AI
agents. Instead of trusting the first output, you have another LLM critique it. The output
quality goes up significantly, especially for complex or ambiguous incidents.

---

## 2. WHAT we built — file by file

```
src/sentinel/agents/
├── analyst.py         ← NEW: root_cause_analyst_node, critic_node,
│                              after_critic_routing, finalize_node
├── graph.py           ← UPDATED: investigators now converge on root_cause_analyst,
│                                 reflection loop wired with add_conditional_edges
├── state.py           ← UPDATED: RootCauseFindings, CritiqueResult, 3 new state fields
├── triager.py         ← FIXED: removed stale done=True (wrong node was setting it)
└── api/incidents.py   ← UPDATED: root_cause_findings + critique in response
```

---

## 3. HOW it works — concept by concept

### 3a. Cycles in LangGraph

Until Phase 3, the graph was a DAG — no loops. Phase 4 introduces the first cycle:

```
root_cause_analyst → critic → after_critic_routing
                                    ↙            ↘
                         "root_cause_analyst"   "finalize"
                         (loop back)               ↓
                                                  END
```

LangGraph allows cycles. The only rule: you need a termination condition, otherwise the
graph loops forever. Ours is `_MAX_REVISIONS = 2` — the routing function caps the loop.

### 3b. `add_conditional_edges` with a string return

In Phase 3, `supervisor_node` returned `list[Send]` (dynamic fan-out to multiple nodes).
`after_critic_routing` is simpler — it returns a single string: either a node name or
`"finalize"`. LangGraph routes to whichever node that string names:

```python
def after_critic_routing(state: IncidentState) -> str:
    revision_count = state.get("revision_count", 0)
    if revision_count >= _MAX_REVISIONS:
        return "finalize"
    critique = state.get("critique")
    if critique is None or critique.approved:
        return "finalize"
    return "root_cause_analyst"
```

The routing function reads state but **cannot write to it**. It only decides where to go next.

### 3c. The parallel-to-sequential join

The three investigators all write to `investigator_findings` simultaneously (parallel fan-out
via `Send`). After Phase 3 they went to `END`. In Phase 4 they all go to `root_cause_analyst`:

```python
builder.add_edge("log_detective", "root_cause_analyst")
builder.add_edge("metric_analyst", "root_cause_analyst")
builder.add_edge("topology_mapper", "root_cause_analyst")
```

LangGraph sees three edges converging on one node and automatically acts as a **barrier** —
it waits for all three parallel branches to complete before running `root_cause_analyst`.
You don't have to write any synchronisation code. The reducer merged their results into
`investigator_findings` (full list), and then the analyst reads the full list.

### 3d. Why two separate LLM instances

```python
_analyst_llm = _llm.with_structured_output(RootCauseFindings)
_critic_llm  = _llm.with_structured_output(CritiqueResult)
```

Same base `_llm`, but two different structured output wrappers — one bound to
`RootCauseFindings`, one to `CritiqueResult`. The LLM is stateless; the wrapper just
tells LangChain which Pydantic schema to parse the response into.

### 3e. The revision context — how the analyst improves

When the critic rejects, the analyst doesn't start from scratch. It gets the critique
feedback injected into its next prompt:

```python
critique = state.get("critique")
revision_section = (
    f"\nREVISION FEEDBACK (address every point):\n{critique.feedback}"
    if critique and not critique.approved
    else ""
)
```

This is why the state doesn't need a history of all past root causes — the analyst only
needs the most recent critique to know what to fix. The state always holds the *current*
version of each field (overwrite, not append).

### 3f. `revision_count` — cycle guard

The analyst increments `revision_count` each time it runs:

```python
return {
    "root_cause_findings": raw,
    "revision_count": revision + 1,   # ← read current, return current+1
    "notes": [note],
}
```

The routing function reads it to cap the loop:
- After first analyst run: `revision_count = 1`
- After second analyst run: `revision_count = 2` → routing returns `"finalize"` regardless

No reducer needed — only one node writes to it, sequentially.

### 3g. `finalize_node` — where `done` actually gets set

`done: True` used to be set by the triager (wrong — triager is step 1 of 5). Phase 4 fixes
this: `finalize_node` is the last node in the graph and the only one that sets `done=True`.

```python
def finalize_node(state: IncidentState) -> dict[str, object]:
    return {"done": True}
```

This makes the graph semantically correct — `done` is True only when the full pipeline
(triage → investigate → synthesize → critique → finalize) has completed.

---

## 4. Full graph after Phase 4

```
START
  ↓
triager
  ↓ (add_conditional_edges → supervisor_node → list[Send])
  ├──────────────────────────────────────────────────┐
  ↓                       ↓                          ↓
log_detective       metric_analyst           topology_mapper
  │                       │                          │
  └───────────────────────┴──────────────────────────┘
                           ↓ (barrier — waits for all 3)
                   root_cause_analyst  ←─────────────┐
                           ↓                         │ (loop back on rejection)
                         critic                      │
                           ↓                         │
                   after_critic_routing ──────────────┘
                           ↓ (approved or max revisions)
                        finalize
                           ↓
                          END
```

---

## 5. WHEN to use the reflection loop

| Use it when | Skip it when |
|---|---|
| Output quality matters more than latency | Latency is critical (adds 1–2 LLM calls) |
| First-pass LLM output tends to be vague | Task is simple and well-constrained |
| You can write clear approval criteria | Approval criteria are subjective/unclear |
| The cost of a wrong answer is high | Errors are easy to recover from |

---

## 6. Mistakes made (learn from these)

### Mistake 1: `done=True` in the wrong node
The triager was setting `done=True` since Phase 0, when it was the last node. After adding
more nodes, `done` was being set too early. Fix: remove it from triager, add `finalize_node`
as the explicit terminal node.

### Mistake 2: `NotRequired` vs `Annotated[..., add]` confusion
Single-value fields that get overwritten (`root_cause_findings`, `critique`) need
`NotRequired` but NOT a reducer. List fields that get merged from parallel branches need
`Annotated[list[X], add]` — the reducer implicitly handles the "not present yet" case.

---

## 7. Interview questions this phase prepares you for

**Q: What is the reflection loop pattern in AI agents?**
> A second LLM critiques the output of a first LLM. If the critique rejects, the first
> LLM revises using the feedback. This cycles until the critic approves or a revision cap
> is hit. It significantly improves output quality for tasks where "good enough" isn't good
> enough — root cause analysis, code review, document drafting.

**Q: How do you implement cycles in LangGraph?**
> Use `add_conditional_edges` with a routing function that returns a node name to loop back
> or a terminal node name to exit. Guard the cycle with a counter in state to prevent
> infinite loops.

**Q: How does LangGraph handle parallel branches converging on a single node?**
> When multiple edges point to the same node (e.g., three investigators all going to
> `root_cause_analyst`), LangGraph uses a barrier — it waits for all incoming branches to
> complete, merges their state updates via reducers, then runs the converging node once.

**Q: What's the difference between a routing function and a node?**
> A node does work and returns a partial state dict. A routing function only decides where
> to go next — it returns a node name (string) or list of Send objects, and cannot write
> to state. Routing functions go in `add_conditional_edges`, not `add_node`.

**Q: Why increment `revision_count` in the analyst rather than the routing function?**
> Routing functions cannot write to state. Only nodes can. The analyst node is the one that
> "consumes" a revision slot, so it's the right place to increment the counter.

---

## 8. Key commands

```bash
# Inject failure
Invoke-RestMethod -Uri "http://localhost:8000/lab/services/api-gateway/inject" -Method POST -ContentType "application/json" -Body '{"mode":"crash_loop"}'

# Trigger incident (full Phase 4 pipeline)
Invoke-RestMethod -Uri "http://localhost:8000/incidents" -Method POST -ContentType "application/json" -Body '{"alert_id":"test-phase4","service":"api-gateway","message":"Service is crash-looping","severity":"critical"}' | ConvertTo-Json -Depth 10

# What to look for in the response:
# - notes: 6 entries (triager, 3 investigators, analyst, critic)
# - root_cause_findings.root_cause: one precise sentence
# - critique.approved: true
# - done: true
```
