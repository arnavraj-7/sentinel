# Phase 5 — Human in the Loop (HITL)

> **Status:** Complete — two-call flow verified live. Graph pauses, human approves, executor heals the service.
>
> **Duration:** 1 session
>
> **Deliverable:** The graph pauses before executing any fix, surfacing the root cause and
> recommended action to a human via the API. The human approves or rejects via a second
> endpoint. Only on approval does the executor call the lab's `/heal` endpoint.

---

## 1. WHY this phase exists

An autonomous agent that diagnoses AND fixes without human oversight is dangerous in
production. If the diagnosis is wrong, an auto-executor could restart a service that was
deliberately stopped, roll back a deploy that wasn't the cause, or escalate an outage.

The industry standard: **diagnose fully → show the human → get approval → execute.**

This is what makes Sentinel a *copilot*, not a script. It does the hard cognitive work
(triage, investigation, synthesis, critique) but defers the consequential action to a human.

HITL also makes the system auditable — every fix is tied to a human decision.

---

## 2. WHAT we built — file by file

```
src/sentinel/agents/
├── executor.py        ← NEW: human_approval_node, executor_node, after_human_routing
├── analyst.py         ← UPDATED: after_critic_routing now routes to "human_approval"
│                                  instead of "finalize"
├── graph.py           ← UPDATED: human_approval + executor nodes wired in
└── state.py           ← UPDATED: human_decision: NotRequired[str]

src/sentinel/api/
└── incidents.py       ← REWRITTEN: two endpoints, status field, interrupt_payload,
                                     _build_response() helper, Command import
```

---

## 3. HOW it works — concept by concept

### 3a. `interrupt(value)` — freezing the graph

Inside any node, calling `interrupt(value)` does three things:
1. Saves the complete graph state to the checkpointer (SQLite)
2. Returns `value` to whoever called `graph.ainvoke()` — this is what the human sees
3. Suspends execution — nothing below `interrupt()` runs until the graph is resumed

```python
def human_approval_node(state: IncidentState) -> dict[str, object]:
    rca = state["root_cause_findings"]
    decision = interrupt({                 # ← graph FREEZES here
        "root_cause": rca.root_cause,     # ← this dict goes OUT to the API caller
        "recommended_fix": rca.recommended_fix,
        "confidence": rca.confidence,
    })
    return {"human_decision": decision}   # ← runs only after resume
```

### 3b. `Command(resume=value)` — resuming the graph

The human calls the approve endpoint with their decision. The API resumes the graph:

```python
from langgraph.types import Command

final_state = await graph.ainvoke(
    Command(resume="approved"),                          # ← human's answer
    config={"configurable": {"thread_id": incident_id}} # ← same thread as original call
)
```

LangGraph loads the frozen state from SQLite using `thread_id`, injects `"approved"` as
the return value of `interrupt()`, and continues from the next line. `decision` in the
node becomes `"approved"`.

### 3c. `thread_id` — the link between two API calls

The `thread_id` in `config["configurable"]` is what LangGraph uses to find the right
frozen state in SQLite. It must be identical in both calls. We use `incident_id` as the
thread_id — one incident = one thread = one SQLite checkpoint.

This is why the checkpointer was set up in Phase 0 — HITL requires it.

### 3d. Two-call API flow

```
POST /incidents
  → graph runs: triager → investigators → analyst → critic → human_approval
  → hits interrupt() → saves state to SQLite
  → returns: { status: "pending_approval", done: false, interrupt_payload: {...} }

Human reads interrupt_payload, decides to approve.

POST /incidents/{id}/approve  body: {"approved": true}
  → graph resumes from interrupt()
  → decision = "approved"
  → after_human_routing → "executor"
  → executor calls /lab/services/{service}/heal
  → finalize sets done=True
  → returns: { status: "completed", done: true, notes: [...executor note...] }
```

### 3e. Why `interrupt_payload` in the response

When `ainvoke` returns after hitting `interrupt()`, the interrupted state doesn't directly
include the value passed to `interrupt()` — you have to call `graph.get_state()` to get it.

Instead, we detect the pause by checking `done: false` and reconstruct the payload from
`root_cause_findings` which is already in state:

```python
if not done and response.root_cause_findings:
    rca = response.root_cause_findings
    response.interrupt_payload = {
        "root_cause": rca.root_cause,
        "recommended_fix": rca.recommended_fix,
        "confidence": rca.confidence,
    }
```

This gives the API caller everything they need to show the human, without an extra
`get_state()` call.

### 3f. `after_human_routing` — conditional edge on human decision

```python
def after_human_routing(state: IncidentState) -> str:
    approval = state.get("human_decision")
    if approval == "approved":
        return "executor"
    else:
        return "finalize"   # rejected — skip execution, just close out
```

Key: check `approval == "approved"`, not `if approval:`. A rejected string `"rejected"`
is also truthy — `if approval:` would treat it as approved.

### 3g. `executor_node` — the action node

Calls the lab's `/heal` endpoint to reset the service to healthy:

```python
async def executor_node(state: IncidentState) -> dict[str, object]:
    async with httpx.AsyncClient(base_url=settings.lab_base_url, timeout=10.0) as client:
        result = (await client.post(f"/lab/services/{service}/heal")).json()
    return {"notes": [AgentNote(agent="executor", content=f"Healed {service}...")]}
```

In a real system this would call Kubernetes API, AWS SDK, PagerDuty, etc.

### 3h. `_build_response()` helper — DRY principle

Both endpoints return the same `IncidentResponse` shape. Rather than duplicating the
construction logic, a shared helper builds it from the state dict:

```python
def _build_response(incident_id: str, state: dict) -> IncidentResponse:
    done = state.get("done", False)
    return IncidentResponse(
        status="completed" if done else "pending_approval",
        ...
    )
```

---

## 4. Full graph after Phase 5

```
START → triager → [log_detective, metric_analyst, topology_mapper]
                           ↓ (converge)
                   root_cause_analyst ←──── (loop back on rejection)
                           ↓
                         critic
                           ↓
                   after_critic_routing
                           ↓ (approved/max revisions)
                   human_approval  ← GRAPH PAUSES HERE (interrupt())
                           ↓ (resume with Command)
                   after_human_routing
                    ↙              ↘
               executor          finalize  (rejected path)
                   ↓                ↓
               finalize            END
                   ↓
                  END
```

---

## 5. WHEN to use `interrupt()` vs other patterns

| Pattern | Use when |
|---|---|
| `interrupt()` | You need a human decision before the graph can continue |
| Conditional edge | Routing is deterministic based on state (no human needed) |
| External webhook | Human responds async via a separate system (Slack bot, PagerDuty) |
| `interrupt()` + timeout | You want the human to respond within N minutes, then auto-proceed |

---

## 6. Mistakes made (learn from these)

### Mistake 1: `from click import Command`
`click` is a CLI library. `Command` for resuming LangGraph comes from `langgraph.types`.

### Mistake 2: `if approval:` instead of `if approval == "approved":`
`"rejected"` is truthy. Both strings pass `if approval:`. Always compare strings explicitly.

### Mistake 3: `config={"thread_id": incident_id}`
The thread_id goes inside a nested `"configurable"` key:
`config={"configurable": {"thread_id": incident_id}}`. LangGraph ignores top-level keys.

### Mistake 4: Routing function inside function body
`@router.post(...)` decorator placed inside `trigger_incident` after a `return` statement.
FastAPI routes must be registered at module level — never nested inside another function.

---

## 7. Interview questions this phase prepares you for

**Q: How does HITL work in LangGraph?**
> `interrupt(value)` inside a node freezes the graph, persists state to the checkpointer,
> and returns `value` to the `ainvoke` caller. The human reads the value and responds via
> a separate API call that resumes the graph with `Command(resume=decision)` using the
> same `thread_id`. The graph continues from the exact line after `interrupt()`.

**Q: Why does HITL require a checkpointer?**
> The graph state must survive between the two separate `ainvoke` calls (which may be
> seconds or hours apart). The checkpointer (SQLite in our case) persists the complete
> graph state — every field, every node's outputs — keyed by `thread_id`. Without it,
> `interrupt()` throws an error.

**Q: What's the difference between `interrupt(value)` and returning from a node?**
> `return` sends a state update and the graph immediately moves to the next node.
> `interrupt(value)` pauses the graph entirely — nothing runs until explicitly resumed
> with `Command(resume=...)`. The graph can stay paused indefinitely.

**Q: How do you prevent an autonomous agent from taking destructive actions?**
> Insert a HITL node before any consequential action using `interrupt()`. The node
> surfaces what the agent intends to do. Only if a human explicitly approves does the
> routing function proceed to the executor. Rejections route to a safe terminal node.

---

## 8. Key commands

```bash
# Step 1 — trigger incident (graph runs to interrupt, returns pending)
Invoke-RestMethod -Uri "http://localhost:8000/incidents" -Method POST -ContentType "application/json" -Body '{"alert_id":"test-phase5","service":"api-gateway","message":"Service is crash-looping","severity":"critical"}' | ConvertTo-Json -Depth 10

# Copy incident_id from response, then:

# Step 2 — approve (graph resumes, executor heals the service)
Invoke-RestMethod -Uri "http://localhost:8000/incidents/INCIDENT_ID/approve" -Method POST -ContentType "application/json" -Body '{"approved":true}' | ConvertTo-Json -Depth 10

# Step 2 alt — reject (graph resumes, skips executor, closes out cleanly)
Invoke-RestMethod -Uri "http://localhost:8000/incidents/INCIDENT_ID/approve" -Method POST -ContentType "application/json" -Body '{"approved":false}' | ConvertTo-Json -Depth 10
```
