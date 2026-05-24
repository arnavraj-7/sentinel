# Phase 14a — End-to-End Smoke Run (Companion Notes)

> **Status:** Full incident graph fired against a multi-module FastAPI test
> repo with a real bug. Sub-graph dispatched correctly, Claude Code produced
> a verified patch (committed in the sandbox), differential test gate passed,
> graph routed through the per-step executor without surprises. Prod-verify
> failed as expected — promote isn't built yet (Phase 16c).
>
> **Deliverable:** Evidence that the Phase 14a wiring works against the
> *real* dependency stack (Gemini-2.5-flash for the agent chain, Claude
> Code SDK for the patch), and a reproducible harness for the next phases.

---

## 1. WHAT was demonstrated

One incident, end-to-end:

```
triager (surge_5xx, 100%)
  → log_detective (100%) — found UnboundLocalError trace
  → metric_analyst (95%) — CPU 95%, error_rate 47%, latency 959ms
  → topology_mapper
  → root_cause_analyst (95%): "UnboundLocalError in apply_tier_discount
                              because 'discount' is accessed before
                              assignment for non-PREMIUM/GOLD tiers"
  → critic (APPROVED, 100%)
  → HITL #1 (RCA)              [auto-approved]
  → planner: [apply_code_patch, verify_health, verify_metrics]
  → HITL #2 (plan — dangerous) [auto-approved]
  → after_step_routing → code_patch (sub-graph)
       └─ CC SDK ~2 min: locate bug, fix, write tests, commit
       └─ sandbox_verifier: pass-on-fix ✓, fail-on-parent ✓ → VERIFIED
  → after_step_routing → executor (verify_health, idx=1)
  → after_step_routing → executor (verify_metrics, idx=2)  [last-step note]
  → after_step_routing → verifier (prod)
  → verifier: FAIL (lab still SURGE_5xx — no promote step)
  → planner replans (attempts 2, 3) → exhausted → escalated
  → finalize → post_mortem
```

All the Phase 14a integration points fired correctly:
- **Per-step executor** processed one step per invocation (`next_step_index`
  bumped each time).
- **after_step_routing** dispatched APPLY_CODE_PATCH → `code_patch`, and
  the next two steps → `executor`, with no `if from_subgraph` branching.
- **Sub-graph wrapper** built `CodePatchState` from parent state, invoked
  the compiled sub-graph, translated outcome → parent delta (one
  `StepResult` + `next_step_index += 1` + `code_patch_result`).
- **Retry feedback** wasn't exercised (CC got it right on attempt 1) but
  the wiring is in place.

---

## 2. The test repo (the harness, not Sentinel)

`D:/projects/codefix-testrepo` was rebuilt from a 7-line `calculate_total`
demo into a **multi-module FastAPI service** so CC has to actually navigate
the codebase, not solve a single-file puzzle:

```
codefix-testrepo/
  app.py                    FastAPI /checkout endpoint
  models/order.py           OrderInput, Item, PricedOrder (Pydantic)
  models/customer.py        Customer, CustomerTier enum
  services/pricing.py       pipeline: subtotal → discount → promo → tax
  services/discounts.py     ← THE BUG lives here
  services/taxes.py         regional tax rates
  services/validators.py    order invariants
  repository/customers.py   in-memory customer DB
  tests/test_pricing.py     5 tests covering PREMIUM + GOLD only
  tests/test_taxes.py       parameterised regional tax tests
  tests/test_validators.py  validator boundary tests
  pyproject.toml + README
```

**The bug** — `services/discounts.py:apply_tier_discount` is an if/elif
chain for PREMIUM and GOLD with no `else`:

```python
if customer.tier == CustomerTier.PREMIUM:
    discount = subtotal * 0.20
elif customer.tier == CustomerTier.GOLD:
    discount = subtotal * 0.10
return subtotal - discount   # UnboundLocalError on STANDARD tier
```

STANDARD-tier customers (which the existing tests don't cover — that's
why the bug shipped) hit `UnboundLocalError` on every checkout.

**Why this bug is "good" for testing the harness:**

1. It's deterministic — restart/scale/rollback won't help, only a code
   patch. Forces the planner to choose APPLY_CODE_PATCH for the right
   reason.
2. The trace points to one specific file — CC has a breadcrumb to follow
   (the realistic case; blind navigation would still work but slower).
3. The fix requires **a new test for the STANDARD tier**. The existing
   test files cover premium and gold; CC has to author a regression
   test that fails on the parent (proves the bug was real) and passes
   on the fix (proves the fix works). The differential gate then validates
   it isn't fake.
4. The codebase is large enough (~13 files of real code) that grep + read
   is genuinely needed — not "scan one file."

---

## 3. The leak-safe alert — the discipline this run validates

The standing rule:

> Any incident `message` / `alert_id` sent (eval or demo) MUST be
> symptom-level and category-agnostic; NEVER name the failure mode.

The alert in this run:

```json
{
  "alert_id": "alert-checkout-001",
  "service": "payment-service",
  "message": "Checkout endpoint returning 500 errors intermittently —
              multiple customer complaints about failed orders in the
              last 15 minutes. Error rate climbing.",
  "severity": "high"
}
```

Notice what's **not** there: UnboundLocalError, discount, tier, file
path, line number, function name. The system *discovered* every one
of those from the logs that log_detective read — the same way an
on-call engineer would. If the alert had said "UnboundLocalError in
discounts.py" the whole RCA pipeline would be a fancy paraphrase
exercise, not a diagnostic test.

Where does the failure-mode information come from? The lab's
`poison_log` endpoint — we pre-poison `payment-service`'s log feed
with a realistic Python traceback before firing the incident. Those
poisoned lines look like raw application logs to log_detective; that's
the source of truth, not the alert. The discipline is: **alerts trigger,
logs explain.**

---

## 4. The artifact — CC's commit

`58c8711 fix: initialize discount to 0 for non-PREMIUM/GOLD tiers in apply_tier_discount`

```diff
 def apply_tier_discount(subtotal: float, customer: Customer) -> float:
     """Apply the customer's loyalty-tier discount to the subtotal."""
     if customer.tier == CustomerTier.PREMIUM:
         discount = subtotal * 0.20
     elif customer.tier == CustomerTier.GOLD:
         discount = subtotal * 0.10
+    else:
+        discount = 0.0
     return subtotal - discount
```

Plus two new regression tests in `tests/test_pricing.py`:

```python
def test_standard_customer_gets_no_tier_discount():
    """Regression: /checkout 500s when tier is neither PREMIUM nor GOLD."""
    c = Customer(id="c-99412", tier=CustomerTier.STANDARD, region="US")
    priced = compute_order_total(_order("c-99412", price=100.0), c)
    assert priced.subtotal == 100.0
    assert priced.discount == 0.0
    assert priced.total == 107.25         # 100 * 1.0725

def test_standard_customer_with_promo_only():
    """Standard tier + promo: only the promo applies, no tier discount."""
    c = Customer(id="c-6", tier=CustomerTier.STANDARD, region="US")
    priced = compute_order_total(_order("c-6", price=100.0, promo="WELCOME10"), c)
    assert priced.discount == 10.0
    assert priced.total == 96.53          # 90 * 1.0725, rounded
```

**Differential check ran and passed:**

- pass-on-fix: full suite green at `58c8711` (15 tests including the 2 new
  STANDARD tests) ✓
- fail-on-parent: `test_standard_customer_*` fail with UnboundLocalError
  against `b17daf8` (the buggy commit) ✓

CC's tests are real regression tests, not fake-passing assertions. The
asymmetric-safety contract held.

---

## 5. Issues exposed (backlog for 16c + 17)

### 5a. Prod-verify fails because the patch only lives in the sandbox

Outcome: `EXHAUSTED`, not `RESOLVED`. The lab service stays in SURGE_5xx
because the fix is committed in a sandbox clone — not promoted to the
"prod" repo. The planner replans the same apply_code_patch (which keeps
succeeding in the sandbox while prod stays broken), tries `rollback`
once, then exhausts.

Fix → **Phase 16c**: a `promote` step that copies the verified commit
from the sandbox to the prod repo (or pushes via `git fetch +
git merge --ff-only` from the prod side), plus a new
`IncidentOutcome.PROMOTED` (or split `RESOLVED` into `VERIFIED_IN_SANDBOX`
/ `PROMOTED_TO_PROD`). The current EXHAUSTED outcome is *correct given
the current capabilities* but misleading — the patch was real.

### 5b. HITL fires on every replan that contains a Dangerous action

The plan-HITL gate fires on each new plan independently. Three replans
with apply_code_patch / rollback → three plan-HITL gates in a row, each
asking for approval on a near-identical plan. Architecturally correct
(every plan IS a separate decision), UX-wise repetitive. Future
improvement (out of scope for 16c): "remember approval for the same
plan-shape" or "auto-approve replans within N seconds of a prior
approval."

### 5c. `IncidentResponse` doesn't surface `code_patch_result` / `executor_result`

The HTTP response only carries `triager_findings`, `investigator_findings`,
`root_cause_findings`, `critique`, `notes`, `outcome`, `post_mortem`. The
sub-graph's `CodePatchResult` (outcome, attempts, last_report.commit_sha,
files_touched, summary) and the per-step `executor_result` list are in
state but not exposed.

For the smoke test this didn't matter — the notes timeline carried
enough signal ("apply_code_patch=ok, verify_health=ok") and the sandbox
itself was inspectable on disk. For Phase 17 (frontend) it'll matter a
lot: the UI needs the diff + the patch summary + the per-step results to
render meaningfully.

Fix → **part of Phase 17 prep**: extend `IncidentResponse` with
`code_patch_result: CodePatchResult | None` and
`executor_result: list[StepResult]`. Trivial, just hadn't been needed
before.

### 5d. Streaming visibility — the e2e is a black box between HITL gates

The driver POSTs `/incidents`, gets back a final state (one ainvoke). It
can't see triager-then-investigator-then-RCA streaming in. For a CLI
smoke test that's fine; for a frontend it's the whole point of having a
frontend.

Fix → **Phase 17 backend**: an SSE endpoint
`GET /incidents/{id}/events` that wraps `graph.astream(...)` and emits
per-node updates as they happen. The current `ainvoke` model becomes
"resolve to terminal" while the SSE model becomes "stream every update."

### 5e. CC committed with `Co-Authored-By: Claude Opus 4.7`

That's fine — your standing rule was "no Co-Authored-By on Sentinel's own
commits, but I'm fine with it on CC's commits to sandbox repos" (memory
note). The commit is in the sandbox, not Sentinel. As designed.

---

## 6. How to reproduce

```powershell
# 1. Env vars (the lab datasource is essential — gcp datasource doesn't
#    know about payment-service)
$env:SENTINEL_GITHUB_PROD_LINK = "D:/projects/codefix-testrepo"
$env:SENTINEL_DATASOURCE       = "lab"

# 2. Start Sentinel (it mounts both /incidents and /lab on port 8000)
.venv\Scripts\python.exe -m uvicorn sentinel.main:app --port 8000

# 3. In another shell — Windows console can't print U+2192, set utf-8
$env:PYTHONIOENCODING = "utf-8"
.venv\Scripts\python.exe tests\_check_e2e_incident.py
```

The driver:
1. Heals `payment-service` + clears any prior poisoned logs (idempotent
   reset).
2. Injects `SURGE_5xx`.
3. Poisons the log feed with 12 lines of realistic Python traceback
   pointing at `services/discounts.py:11`.
4. POSTs the symptom-level incident.
5. Auto-approves both HITL gates (and any replan HITLs, up to 5 total).
6. Prints the final state, the notes timeline, and the first 3kB of the
   post-mortem.

The sandbox is at `%LOCALAPPDATA%\Temp\sentinel-sandbox-<incident_id>`.
The CC trace (if `SENTINEL_CC_DEBUG=1` was set) is at
`data/cc-runs/cc-<incident_id>-<stamp>.log`.

---

## 7. WHAT'S NEXT

**Phase 16c** — promote step + the validate-and-promote loop. With this
smoke run in hand, the spec is concrete: after `sandbox_verifier`
emits `outcome=verified`, insert a `promote` step (and a promote HITL
gate, since pushing to prod is Dangerous), then a new `PROMOTED`
outcome that the post-mortem treats as RESOLVED.

**Phase 17** — frontend (slotted in before 16d). The e2e exposed
exactly the backend changes the frontend needs (5c + 5d above).
Building the frontend on this same harness — same poisoned-log
fixture, same multi-module test repo — gives us a 90-second LinkedIn
demo as a side-effect: click "Code Defect" scenario → watch agents
stream → see the diff CC produced → ship.
