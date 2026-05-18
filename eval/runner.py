import httpx

from eval.cases import EvalCase
from eval.scorer import EvalResult, evaluate
from sentinel.config import settings
import time

async def run_eval_cases(original_case: EvalCase) -> EvalResult:
    """Run ONE eval case end-to-end against a running Sentinel server
    (started with SENTINEL_DATASOURCE=lab), then score it.

    base_url is set once on the client so every call uses a relative path —
    no per-call host juggling, one client for all three requests.
    """
    service = original_case.service
    async with httpx.AsyncClient(
        base_url=settings.sentinel_base_url, timeout=300
    ) as client:
        # 1. inject the known failure into the lab (this is the ground truth)
        resp = await client.post(
            f"/lab/services/{service}/inject",
            json={"mode": original_case.inject_mode.value},
        )
        assert resp.status_code == 200, f"inject failed: {resp.status_code} {resp.text}"

        # 2. trigger the incident — graph runs until the HITL interrupt
        Start_Time = time.time()
        trig = await client.post(
            "/incidents",
            json={
                # NOTE: message must NOT name the failure mode — that would
                # leak the label into the triager's prompt (testing on the
                # answer). A real alert is symptom-level and category-agnostic;
                # the triager must derive the category from lab logs+metrics.
                "alert_id": f"eval-{service}",
                "service": service,
                "message": f"Automated monitoring alert: anomaly detected on {service}",
            },
        )
        assert trig.status_code == 200, f"trigger failed: {trig.status_code} {trig.text}"
        incident_id = trig.json()["incident_id"]

        # 3. approve to drive it to completion (executor -> finalize -> post_mortem)
        appr = await client.post(
            f"/incidents/{incident_id}/approve",
            json={"approved": True},
        )
        assert appr.status_code == 200, f"approve failed: {appr.status_code} {appr.text}"
        elapsed_s=time.time()-Start_Time
        case_output = appr.json()

    score = evaluate(original_case, case_output,elapsed_s=elapsed_s)
    return score
