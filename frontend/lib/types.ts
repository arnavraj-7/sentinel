// ─────────────────────────────────────────────────────────────────────────
// Shapes the backend SSE emits + the client-side aggregate state.
// Keep these mirrored to api/incidents.py + api/scenarios.py + state models.
// ─────────────────────────────────────────────────────────────────────────

export type AgentNote = {
  agent: string;
  content: string;
  at: string;
};

export type TriagerFindings = {
  thinking_process: string;
  failure_category: string;
  summary: string;
  affected_services: string[];
  recommended_actions: string[];
};

export type InvestigatorFindings = {
  thinking_process: string;
  agent: string;
  focus: string;
  summary: string;
  evidence: string[];
  confidence: number;
};

export type RootCauseFindings = {
  thinking_process: string;
  root_cause: string;
  contributing_factors: string[];
  confidence: number;
  recommended_fix: string;
};

export type CritiqueResult = {
  thinking_process: string;
  approved: boolean;
  feedback: string;
  confidence: number;
};

export type RemediationStep = {
  remediation_action: string;
  critical: boolean;
  description: string;
};

export type RemediationPlan = {
  thinking_process: string;
  remediation_steps: RemediationStep[];
};

export type StepResult = {
  step: RemediationStep;
  ok: boolean;
  detail: string;
};

export type PatchReport = {
  cc_session_id: string;
  summary: string;
  files_touched: string[];
  commit_sha: string;
  tokens_used?: number | null;
  wall_time_seconds?: number | null;
  tools_used?: string[] | null;
};

export type PatchVerification = {
  ok: boolean;
  description: string;
};

export type CodePatchResult = {
  outcome: "verified" | "exhausted" | "fix_failed" | "fake_test" | "error";
  last_report: PatchReport | null;
  last_verification: PatchVerification | null;
  attempts: number;
};

export type VerificationResult = {
  verified: boolean;
  verdict: string;
};

// ── SSE event envelopes ────────────────────────────────────────────────────

export type InitPayload = {
  incident_id: string;
  scenario?: string;
  title?: string;
  resumed_with?: "approved" | "rejected";
};

export type UpdateChunk = Record<string, Record<string, unknown>>;

export type CustomEvent = {
  agent: string;
  phase: string;
  message?: string;
  // freeform — varies by phase
  [k: string]: unknown;
};

export type PausedPayload = {
  stage: "root_cause" | "plan" | string;
  root_cause?: string;
  recommended_fix?: string;
  confidence?: number;
  dangerous_steps?: RemediationStep[];
  all_steps?: RemediationStep[];
};

export type DonePayload = {
  outcome: string | null;
  post_mortem: string | null;
  code_patch_result: CodePatchResult | null;
  executor_result: StepResult[] | null;
  verification: VerificationResult | null;
};

export type ErrorPayload = {
  message: string;
  type: string;
};

// ── Client-side aggregate state ────────────────────────────────────────────

export type AgentStatus = "idle" | "running" | "done" | "error" | "skipped";

export type AgentState = {
  name: string;
  status: AgentStatus;
  currentMessage?: string;           // live updated from custom events
  progress: Array<{                  // log of custom events
    phase: string;
    message?: string;
    at: number;
    extra?: Record<string, unknown>;
  }>;
  thinkingProcess?: string;
  findings?: Record<string, unknown>; // node-specific structured findings
};

export type IncidentStatus = "idle" | "streaming" | "paused" | "done" | "error";

export type IncidentState = {
  status: IncidentStatus;
  id?: string;
  scenarioName?: string;
  scenarioTitle?: string;
  // Ordered by first-seen so the timeline renders in chronological order.
  agentOrder: string[];
  agents: Record<string, AgentState>;
  // Top-level structured artifacts
  triagerFindings?: TriagerFindings;
  rootCauseFindings?: RootCauseFindings;
  critique?: CritiqueResult;
  plan?: RemediationPlan;
  executorResult: StepResult[];
  verification?: VerificationResult;
  codePatchResult?: CodePatchResult;
  postMortem?: string;
  outcome?: string;
  paused?: PausedPayload;
  error?: ErrorPayload;
};

// ── Scenario registry (GET /scenarios) ─────────────────────────────────────

export type Scenario = {
  name: string;
  title: string;
  description: string;
  service: string;
  failure_mode: string;
  alert_message: string;
  severity: string;
};
