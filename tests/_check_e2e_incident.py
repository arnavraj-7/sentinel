"""End-to-end smoke test — fire a real incident through the FULL Sentinel
graph (NOT just the sub-graph). Tests Phase 14a wiring against the lab + the
order-pricing test repo.

NOT a pytest test (leading underscore). Makes real LLM + Claude Code SDK
calls; expects Sentinel running on localhost:8000.

The whole point of this script is to exercise the discipline:

    The alert message NEVER names the failure mode. It says only what the
    on-call engineer would see — checkout 500s, customer complaints.
    The system must DISCOVER the failure mode (UnboundLocalError on
    STANDARD-tier customers, in services/discounts.py:apply_tier_discount)
    from the LOGS that log_detective reads, NOT from the alert payload.

Prerequisites:
  1. Sentinel running on localhost:8000:
        $env:SENTINEL_GITHUB_PROD_LINK = "D:/projects/codefix-testrepo"
        .venv\\Scripts\\python.exe -m uvicorn sentinel.main:app --port 8000
  2. .env populated (Gemini key, Claude Code auth).

Run (from sentinel repo root, in another shell):
  .venv\\Scripts\\python.exe tests\\_check_e2e_incident.py

The driver:
  - heals payment-service + clears any prior poisoned logs
  - injects SURGE_5xx into payment-service
  - poisons the lab with a realistic UnboundLocalError stack trace pointing
    at services/discounts.py (this is what log_detective will see)
  - POSTs a SYMPTOM-LEVEL incident (no mention of UnboundLocalError, no
    mention of discount/tier/file/line — just 'checkout returning 500s')
  - auto-approves both HITL gates (RCA + plan)
  - prints findings, plan, sub-graph outcome, notes timeline, post-mortem
"""
import asyncio
import sys

import httpx

BASE = "http://localhost:8000"
LAB = f"{BASE}/lab"
SENTINEL = f"{BASE}/incidents"
HEALTH = f"{BASE}/health"

# CC SDK + multi-agent LLM chain → minutes per run. Pad generously.
HTTP_TIMEOUT = 900.0


# ── lab setup ────────────────────────────────────────────────────────────────

# Poisoned log lines — a realistic Python traceback that points at the actual
# buggy file in the test repo. log_detective reads these as plain ERROR-level
# log lines; that's where the system DISCOVERS the failure mode from. The
# alert message itself never names any of this.
_POISONED_LINES: list[tuple[str, str]] = [
    ("ERROR", "500 POST /checkout customer_id=c-99412 order_id=o-44831"),
    ("ERROR", "Traceback (most recent call last):"),
    ("ERROR", '  File "/app/app.py", line 31, in checkout'),
    ("ERROR", "    priced = compute_order_total(order, customer)"),
    ("ERROR", '  File "/app/services/pricing.py", line 13, in compute_order_total'),
    ("ERROR", "    discounted = apply_tier_discount(subtotal, customer)"),
    ("ERROR", '  File "/app/services/discounts.py", line 11, in apply_tier_discount'),
    ("ERROR", "    return subtotal - discount"),
    ("ERROR", "UnboundLocalError: cannot access local variable 'discount' where it is not associated with a value"),
    # A handful of repeats so log_detective sees this isn't one-off — it's a pattern
    ("ERROR", "500 POST /checkout customer_id=c-10003 order_id=o-44832"),
    ("ERROR", "500 POST /checkout customer_id=c-10004 order_id=o-44833"),
    ("ERROR", "500 POST /checkout customer_id=c-10005 order_id=o-44834"),
]


async def setup_lab(client: httpx.AsyncClient, service: str = "payment-service") -> None:
    """Reset, inject SURGE_5xx, push the poisoned stack-trace lines."""
    await client.post(f"{LAB}/services/{service}/heal")
    await client.post(f"{LAB}/services/{service}/clear_poison")
    await client.post(f"{LAB}/services/{service}/inject", json={"mode": "surge_5xx"})
    for level, msg in _POISONED_LINES:
        await client.post(
            f"{LAB}/services/{service}/poison_log",
            json={"level": level, "message": msg},
        )
    print(f"  {service}: SURGE_5xx injected + {len(_POISONED_LINES)} poisoned log lines")


# ── incident driver ──────────────────────────────────────────────────────────

async def fire_incident(client: httpx.AsyncClient) -> dict:
    """POST a SYMPTOM-LEVEL alert. The message describes what a human on-call
    would observe — NEVER the failure mode, never the file, never the error
    class. Leakage here would defeat the whole point of the test."""
    payload = {
        "alert_id": "alert-checkout-001",
        "service": "payment-service",
        "message": (
            "Checkout endpoint returning 500 errors intermittently — "
            "multiple customer complaints about failed orders in the "
            "last 15 minutes. Error rate climbing."
        ),
        "severity": "high",
    }
    print(f"  alert_id  : {payload['alert_id']}")
    print(f"  service   : {payload['service']}")
    print(f"  severity  : {payload['severity']}")
    print(f"  message   : {payload['message']}")
    resp = await client.post(SENTINEL, json=payload)
    resp.raise_for_status()
    return resp.json()


# ── pretty printers ──────────────────────────────────────────────────────────

def _truncate(value, n: int = 120) -> str:
    s = str(value or "")
    return s if len(s) <= n else s[:n] + "…"


def _print_summary(body: dict, header: str) -> None:
    print(f"\n--- {header} ---")
    print(f"  status: {body['status']}, done: {body['done']}")
    if body.get("triager_findings"):
        t = body["triager_findings"]
        print(f"  triager       : category={t.get('failure_category')} — "
              f"{_truncate(t.get('summary'), 90)}")
    for inv in body.get("investigator_findings") or []:
        print(f"  {inv['agent']:14s}: conf={inv['confidence']:.0%} — "
              f"{_truncate(inv['summary'], 90)}")
    if body.get("root_cause_findings"):
        rca = body["root_cause_findings"]
        print(f"  RCA           : conf={rca.get('confidence', 0):.0%}")
        print(f"    root_cause       : {_truncate(rca.get('root_cause'), 150)}")
        print(f"    recommended_fix  : {_truncate(rca.get('recommended_fix'), 150)}")
    if body.get("critique"):
        c = body["critique"]
        print(f"  critic        : approved={c['approved']}, conf={c['confidence']:.0%}")


def _print_interrupt(payload: dict) -> None:
    stage = payload.get("stage", "?")
    print(f"\n  >>> HITL GATE: stage={stage}")
    if stage == "root_cause":
        print(f"      root_cause       : {_truncate(payload.get('root_cause'), 150)}")
        print(f"      recommended_fix  : {_truncate(payload.get('recommended_fix'), 150)}")
        print(f"      confidence       : {payload.get('confidence')}")
    elif stage == "plan":
        for s in payload.get("all_steps", []):
            print(f"      - {s.get('remediation_action'):20s} "
                  f"(critical={s.get('critical')}): "
                  f"{_truncate(s.get('description'), 80)}")


# ── main ─────────────────────────────────────────────────────────────────────

async def main() -> None:
    print("=" * 72)
    print("Sentinel — Phase 14a end-to-end smoke test (REAL LLM + CC SDK)")
    print("=" * 72)

    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
        # health probe — fail loud + helpfully if Sentinel isn't up
        try:
            r = await client.get(HEALTH)
            r.raise_for_status()
        except (httpx.ConnectError, httpx.HTTPStatusError):
            sys.exit(
                "FATAL: Sentinel not reachable on localhost:8000.\n"
                "Start it (PowerShell):\n"
                '  $env:SENTINEL_GITHUB_PROD_LINK = "D:/projects/codefix-testrepo"\n'
                "  .venv\\Scripts\\python.exe -m uvicorn sentinel.main:app --port 8000"
            )

        print("\n[1/4] Resetting lab + injecting failure + poisoning logs…")
        await setup_lab(client)

        print("\n[2/4] Firing incident (SYMPTOM-LEVEL message — never the failure mode):")
        body = await fire_incident(client)
        incident_id = body["incident_id"]
        print(f"\n  incident_id: {incident_id}")
        _print_summary(body, "After first ainvoke (triager → investigators → RCA → critic)")

        print("\n[3/4] Driving HITL gates (auto-approve)…")
        gate_count = 0
        while body["status"] == "pending_approval":
            gate_count += 1
            interrupt = body.get("interrupt_payload") or {}
            _print_interrupt(interrupt)
            print("      approving…")
            resp = await client.post(
                f"{SENTINEL}/{incident_id}/approve",
                json={"approved": True},
            )
            resp.raise_for_status()
            body = resp.json()
            _print_summary(body, f"After HITL gate #{gate_count}")
            if gate_count > 5:
                sys.exit("FATAL: more than 5 HITL gates — likely a loop. Aborting.")

        print("\n[4/4] Terminal state")
        _print_summary(body, "TERMINAL")
        print(f"  outcome: {body.get('outcome')}")

        print("\n--- Notes timeline ---")
        for n in body.get("notes") or []:
            t = (n.get("at") or "")[:19].replace("T", " ")
            print(f"  [{t}] {n['agent']:18s}: {_truncate(n['content'], 110)}")

        if body.get("post_mortem"):
            print("\n--- Post-mortem (truncated to 3 kB) ---")
            print(body["post_mortem"][:3000])
            if len(body["post_mortem"]) > 3000:
                print("\n… (full file at data/post-mortems/<incident_id>.md)")
        else:
            print("\n(No post-mortem in response — check data/post-mortems/ for the file.)")


if __name__ == "__main__":
    asyncio.run(main())
