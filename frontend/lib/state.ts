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
      return {
        ...INITIAL_INCIDENT,
        status: "streaming",
        id: action.payload.incident_id,
        scenarioName: action.payload.scenario,
        scenarioTitle: action.payload.title,
      };

    case "update":
      return applyUpdate(state, action.chunk);

    case "custom":
      return applyCustom(state, action.payload);

    case "paused":
      return { ...state, status: "paused", paused: action.payload };

    case "done":
      return applyDone(state, action.payload);

    case "error":
      return { ...state, status: "error", error: action.payload };
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
  // The node has completed — its delta is the merge over state.
  // We capture node-specific artifacts and mark the agent done.

  const agent = getAgent(state, nodeName);
  const updated: AgentState = {
    ...agent,
    name: nodeName,
    status: "done",
    findings: { ...(agent.findings ?? {}), ...delta },
  };

  // Extract `thinking_process` if present on common finding shapes
  const thinking = pickThinking(delta);
  if (thinking) updated.thinkingProcess = thinking;

  let next = withAgent(state, nodeName, updated);

  // Top-level structured artifacts — pull them out for dedicated panels.
  if (nodeName === "triager" && delta.triager_findings) {
    next = { ...next, triagerFindings: delta.triager_findings as TriagerFindings };
  }
  if (delta.investigator_findings) {
    const findings = delta.investigator_findings as InvestigatorFindings[];
    // Each investigator node's delta carries the finding for its own agent
    // (via the add reducer). Attach back to the matching agent row.
    for (const f of findings) {
      const inv = getAgent(next, f.agent);
      next = withAgent(next, f.agent, {
        ...inv,
        status: "done",
        thinkingProcess: f.thinking_process,
        findings: { ...(inv.findings ?? {}), ...(f as unknown as Record<string, unknown>) },
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
