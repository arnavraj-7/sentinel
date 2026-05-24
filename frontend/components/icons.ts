// Agent → icon mapping. Each graph node + sub-graph node has a distinct
// icon that hints at its role. Keep the icon set small and visually
// related (lucide line-icons — uniform stroke weight).

import {
  Activity,
  AlertTriangle,
  BookText,
  Brain,
  CheckCircle2,
  CircleAlert,
  FileText,
  GitBranch,
  ListChecks,
  Network,
  PlayCircle,
  Scale,
  ScrollText,
  Search,
  ShieldCheck,
  Stethoscope,
  TrendingUp,
  UserCheck,
  Wrench,
  type LucideIcon,
} from "lucide-react";

export const AGENT_ICONS: Record<string, LucideIcon> = {
  triager: Stethoscope,
  log_detective: ScrollText,
  metric_analyst: TrendingUp,
  topology_mapper: Network,
  root_cause_analyst: Brain,
  critic: Scale,
  human_approval_rca: UserCheck,
  human_approval_plan: UserCheck,
  planner: ListChecks,
  executor: PlayCircle,
  code_patch: GitBranch,         // parent wrapper
  code_fixer: Wrench,            // sub-graph: produce patch
  sandbox_verifier: ShieldCheck, // sub-graph: differential test gate
  verifier: Activity,            // prod verifier
  finalize: CheckCircle2,
  post_mortem: BookText,
  scribe: BookText,
};

// Friendly display names — what shows next to the icon.
export const AGENT_LABELS: Record<string, string> = {
  triager: "Triager",
  log_detective: "Log Detective",
  metric_analyst: "Metric Analyst",
  topology_mapper: "Topology Mapper",
  root_cause_analyst: "Root Cause Analyst",
  critic: "Critic",
  human_approval_rca: "HITL · Root Cause",
  human_approval_plan: "HITL · Plan",
  planner: "Runbook Planner",
  executor: "Executor",
  code_patch: "Code Patch",
  code_fixer: "Code Fixer",
  sandbox_verifier: "Sandbox Verifier",
  verifier: "Prod Verifier",
  finalize: "Finalize",
  post_mortem: "Scribe (Post-Mortem)",
  scribe: "Scribe",
};

// One-line role descriptions — shown as subtitles in the timeline.
export const AGENT_TAGLINES: Record<string, string> = {
  triager: "Classifies incident category from alert + signals",
  log_detective: "Reads logs, extracts errors + stack traces",
  metric_analyst: "Checks metrics against healthy baselines",
  topology_mapper: "Maps blast radius across services",
  root_cause_analyst: "Synthesises findings into a diagnosis",
  critic: "Approves or sends RCA back for revision",
  human_approval_rca: "Operator approves the diagnosis",
  human_approval_plan: "Operator approves the remediation plan",
  planner: "Produces an ordered remediation runbook",
  executor: "Runs one plan step at a time",
  code_patch: "Dispatch to the code-patch sub-graph",
  code_fixer: "Claude Code: locate, fix, test, commit",
  sandbox_verifier: "Differential test gate — pass-on-fix ∧ fail-on-parent",
  verifier: "Verifies prod recovered from remediation",
  finalize: "Resolves the incident with an outcome",
  post_mortem: "Writes the incident report",
  scribe: "Writes the incident report",
};

export const FALLBACK_ICON = CircleAlert;
export const WARNING_ICON = AlertTriangle;
export const FILE_ICON = FileText;
export const SEARCH_ICON = Search;
