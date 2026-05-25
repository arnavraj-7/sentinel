// State reducer for the incident view. Pure function so it's easy to
// test + reason about — the React component owns a useReducer.

import type {
  AgentState,
  AgentStatus,
  CodePatchResult,
  CritiqueResult,
  CustomEvent as CustomPayload,
  DonePayload,
  ErrorPayload,
  IncidentState,
  InitPayload,
  InvestigatorFindings,
  PausedPayload,
  RemediationPlan,
  RootCauseFindings,
  StepResult,
  TriagerFindings,
  UpdateChunk,
  VerificationResult,
} from "./types";

export const INITIAL_INCIDENT: IncidentState = {
  status: "idle",
  agentOrder: [],
  agents: {},
  executorResult: [],
};

type Action =
  | { type: "reset" }
  | { type: "init"; payload: InitPayload }
  | { type: "update"; chunk: UpdateChunk }
  | { type: "custom"; payload: CustomPayload }
  | { type: "paused"; payload: PausedPayload }
  | { type: "done"; payload: DonePayload }
  | { type: "error"; payload: ErrorPayload };

export function incidentReducer(
  state: IncidentState,
  action: Action,
): IncidentState {
  switch (action.type) {
    case "reset":
      return { ...INITIAL_INCIDENT };

    case "init":
      // Merge — DON'T reset. `init` fires at the start of EVERY SSE leg,
      // including resume-after-HITL. The first scenario fire was already
      // preceded by a `reset` (page.tsx#runScenario), which is the only
      // place we want to wipe history. Resume must preserve the agent
      // history accumulated before the pause.
      return {
        ...state,
        status: "streaming",
        id: action.payload.incident_id ?? state.id,
        scenarioName: action.payload.scenario ?? state.scenarioName,
        scenarioTitle: action.payload.title ?? state.scenarioTitle,
        // Pause is now over (we're streaming again post-approve).
        paused: undefined,
      };

    case "update":
      return applyUpdate(state, action.chunk);

    case "custom":
      return applyCustom(state, action.payload);

    case "paused":
      return { ...state, status: "paused", paused: action.payload };

    case "done":
      return applyDone(state, action.payload);

    case "error": {
      // Heuristic: mark whichever agent was running at the moment of the
      // error as 'error' too. Gives the graph + agent list a visible
      // failure point instead of a sea of 'queued' indicators next to a
      // top-level error message.
      const runningName = state.agentOrder.find(
        n => state.agents[n]?.status === "running"
      );
      const nextAgents = runningName
        ? {
            ...state.agents,
            [runningName]: { ...state.agents[runningName], status: "error" as AgentStatus },
          }
        : state.agents;
      return {
        ...state,
        status: "error",
        error: action.payload,
        agents: nextAgents,
      };
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getAgent(state: IncidentState, name: string): AgentState {
  return (
    state.agents[name] ?? {
      name,
      status: "idle",
      progress: [],
    }
  );
}

function withAgent(
  state: IncidentState,
  name: string,
  agent: AgentState,
): IncidentState {
  const seen = state.agents[name] != null;
  return {
    ...state,
    agentOrder: seen ? state.agentOrder : [...state.agentOrder, name],
    agents: { ...state.agents, [name]: agent },
  };
}

function applyUpdate(state: IncidentState, chunk: UpdateChunk): IncidentState {
  // `chunk` is { <node_name>: <state_delta> }. There's usually exactly one
  // node per chunk; loop just in case the backend ever sends multiple.
  let next = state;
  for (const [nodeName, delta] of Object.entries(chunk)) {
    next = applyNodeDelta(next, nodeName, delta);
  }
  return next;
}

function applyNodeDelta(
  state: IncidentState,
  nodeName: string,
  delta: Record<string, unknown>,
): IncidentState {
  // Detect whether this is an investigator's own update (delta carries
  // investigator_findings with an entry matching nodeName). If so, skip
  // the outer progress push — the investigator branch below will emit
  // the richer per-agent entry. Avoids the duplicate row in the trail.
  const invFindings = delta.investigator_findings as InvestigatorFindings[] | undefined;
  const matchingInv = invFindings?.find(f => f.agent === nodeName);

  const agent = getAgent(state, nodeName);
  const updated: AgentState = {
    ...agent,
    name: nodeName,
    status: "done",
    findings: { ...(agent.findings ?? {}), ...delta },
  };

  if (!matchingInv) {
    // Only one progress entry per node update — the message comes from
    // the most-informative field of the delta via summarizeDelta.
    const msg = summarizeDelta(nodeName, delta);
    updated.progress = [...agent.progress, {
      phase: "completed",
      message: msg,
      at: Date.now(),
    }];
    updated.currentMessage = msg;
  }

  // Extract `thinking_process` if present on common finding shapes
  const thinking = pickThinking(delta);
  if (thinking) updated.thinkingProcess = thinking;

  let next = withAgent(state, nodeName, updated);

  // Top-level structured artifacts — pull them out for dedicated panels.
  if (nodeName === "triager" && delta.triager_findings) {
    next = { ...next, triagerFindings: delta.triager_findings as TriagerFindings };
  }
  if (invFindings) {
    // Each investigator node's delta carries the finding for its own agent
    // (via the add reducer). Attach back to the matching agent row + push
    // a trail entry under the investigator's own name (single push — the
    // outer applyNodeDelta deduped against this branch via matchingInv).
    for (const f of invFindings) {
      const inv = getAgent(next, f.agent);
      const invEntry = {
        phase: "completed",
        message: f.summary || `conf ${(f.confidence * 100).toFixed(0)}%`,
        at: Date.now(),
      };
      next = withAgent(next, f.agent, {
        ...inv,
        status: "done",
        thinkingProcess: f.thinking_process,
        findings: { ...(inv.findings ?? {}), ...(f as unknown as Record<string, unknown>) },
        progress: [...inv.progress, invEntry],
        currentMessage: invEntry.message,
      });
    }
  }
  if (nodeName === "root_cause_analyst" && delta.root_cause_findings) {
    next = { ...next, rootCauseFindings: delta.root_cause_findings as RootCauseFindings };
  }
  if (nodeName === "critic" && delta.critique) {
    next = { ...next, critique: delta.critique as CritiqueResult };
  }
  if (nodeName === "planner" && delta.remediation_plan) {
    next = { ...next, plan: delta.remediation_plan as RemediationPlan };
  }
  if (delta.executor_result) {
    // add-reducer style: backend sends THIS step's result as a list of one.
    next = {
      ...next,
      executorResult: [...next.executorResult, ...(delta.executor_result as StepResult[])],
    };
  }
  if (nodeName === "verifier" && delta.verification) {
    next = { ...next, verification: delta.verification as VerificationResult };
  }
  if (delta.code_patch_result) {
    next = { ...next, codePatchResult: delta.code_patch_result as CodePatchResult };
  }
  if (nodeName === "post_mortem" && typeof delta.post_mortem === "string") {
    next = { ...next, postMortem: delta.post_mortem };
  }
  if (nodeName === "finalize" && delta.outcome) {
    next = { ...next, outcome: String(delta.outcome) };
  }

  return next;
}

// One-liner summary per node — picks the most informative field from the
// node's state-delta shape. Used to populate the LiveTrail entry when a
// node completes (so the trail isn't empty for nodes that didn't emit
// custom writer events).
function summarizeDelta(nodeName: string, delta: Record<string, unknown>): string {
  const tf = delta.triager_findings as { failure_category?: string; summary?: string } | undefined;
  if (tf?.summary) return `${tf.failure_category ?? ""}: ${tf.summary}`.trim().replace(/^:\s*/, "");

  const inv = (delta.investigator_findings as InvestigatorFindings[] | undefined)?.[0];
  if (inv?.summary) return inv.summary;

  const rca = delta.root_cause_findings as { root_cause?: string; confidence?: number } | undefined;
  if (rca?.root_cause) return `${rca.root_cause} (${((rca.confidence ?? 0) * 100).toFixed(0)}% conf)`;

  const crit = delta.critique as { approved?: boolean; feedback?: string } | undefined;
  if (crit && typeof crit.approved === "boolean") {
    return crit.approved ? "Approved" : `Rejected: ${crit.feedback ?? "needs revision"}`;
  }

  const plan = delta.remediation_plan as { remediation_steps?: Array<{ remediation_action: string }> } | undefined;
  if (plan?.remediation_steps?.length) {
    const actions = plan.remediation_steps.map(s => s.remediation_action).join(", ");
    return `Plan: ${actions}`;
  }

  const verif = delta.verification as { verified?: boolean; verdict?: string } | undefined;
  if (verif?.verdict) return verif.verdict;

  const cp = delta.code_patch_result as { outcome?: string; attempts?: number } | undefined;
  if (cp?.outcome) return `${cp.outcome} (${cp.attempts ?? 0} attempts)`;

  const er = delta.executor_result as Array<{ ok?: boolean; detail?: string; step?: { remediation_action?: string } }> | undefined;
  if (er?.length) {
    const last = er[er.length - 1];
    const action = last?.step?.remediation_action ?? "step";
    return `${action}: ${last?.detail ?? (last?.ok ? "ok" : "failed")}`;
  }

  if (typeof delta.outcome === "string") return `Outcome: ${delta.outcome}`;
  if (typeof delta.post_mortem === "string") return "Post-mortem written";

  return `${nodeName} completed`;
}

function pickThinking(delta: Record<string, unknown>): string | undefined {
  // Walk the common fields that carry a thinking_process.
  const candidates = [
    "triager_findings",
    "root_cause_findings",
    "critique",
    "remediation_plan",
  ];
  for (const k of candidates) {
    const v = delta[k] as Record<string, unknown> | undefined;
    if (v && typeof v.thinking_process === "string") return v.thinking_process;
  }
  return undefined;
}

function applyCustom(
  state: IncidentState,
  payload: CustomPayload,
): IncidentState {
  const name = payload.agent || "unknown";
  const agent = getAgent(state, name);

  // Skip the `start` heartbeat from causing log noise, but use it to
  // flip status to running.
  const skipFromLog = payload.phase === "start";

  const next: AgentState = {
    ...agent,
    name,
    status: payload.phase === "done" ? agent.status : "running",
    currentMessage: payload.message,
    progress: skipFromLog
      ? agent.progress
      : [
          ...agent.progress,
          {
            phase: payload.phase,
            message: payload.message,
            at: Date.now(),
            extra: stripCommonKeys(payload),
          },
        ],
  };
  return withAgent(state, name, next);
}

function stripCommonKeys(p: CustomPayload): Record<string, unknown> {
  const { agent: _a, phase: _p, message: _m, ...rest } = p;
  void _a; void _p; void _m;
  return rest;
}

function applyDone(state: IncidentState, payload: DonePayload): IncidentState {
  return {
    ...state,
    status: "done",
    outcome: payload.outcome ?? state.outcome,
    postMortem: payload.post_mortem ?? state.postMortem,
    codePatchResult: payload.code_patch_result ?? state.codePatchResult,
    executorResult: payload.executor_result ?? state.executorResult,
    verification: payload.verification ?? state.verification,
  };
}

// ── Display helpers ──────────────────────────────────────────────────────────

export function statusColor(s: AgentStatus): string {
  switch (s) {
    case "running": return "text-running";
    case "done":    return "text-success";
    case "error":   return "text-danger";
    case "skipped": return "text-fg-subtle";
    default:        return "text-fg-subtle";
  }
}
