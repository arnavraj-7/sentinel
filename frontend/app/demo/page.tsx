"use client";

import { useCallback, useMemo, useReducer, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Activity,
  BookText,
  GitBranch,
  ListChecks,
} from "lucide-react";

import { AgentDetail } from "@/components/AgentDetail";
import { AgentGraph } from "@/components/AgentGraph";
import { AgentList } from "@/components/AgentList";
import { CodePatchPanel } from "@/components/CodePatchPanel";
import { DemoLauncher } from "@/components/DemoLauncher";
import { Header } from "@/components/Header";
import { IncidentHeader } from "@/components/IncidentHeader";
import { PostMortemPanel } from "@/components/PostMortemPanel";
import { StickyHITLBanner } from "@/components/StickyHITLBanner";
import { TabBar, type Tab } from "@/components/TabBar";
import { FILTERS, TimelineFeed } from "@/components/TimelineFeed";
import { API_BASE } from "@/lib/api";
import { sseStream } from "@/lib/sse";
import { INITIAL_INCIDENT, incidentReducer } from "@/lib/state";
import type {
  CustomEvent as CustomPayload,
  DonePayload,
  ErrorPayload,
  InitPayload,
  PausedPayload,
  UpdateChunk,
} from "@/lib/types";

type TabId = "timeline" | "graph" | "patch" | "report";

export default function DemoPage() {
  const [incident, dispatch] = useReducer(incidentReducer, INITIAL_INCIDENT);
  const [busy, setBusy] = useState(false);
  const [selectedNode, setSelectedNode] = useState<string | undefined>();
  const [activeTab, setActiveTab] = useState<TabId>("timeline");
  const abortRef = useRef<AbortController | null>(null);

  const pumpStream = useCallback(
    async (url: string, body: object) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setBusy(true);
      try {
        for await (const evt of sseStream(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        })) {
          let parsed: unknown;
          try { parsed = JSON.parse(evt.data); }
          catch { parsed = evt.data; }
          switch (evt.event) {
            case "init":    dispatch({ type: "init",   payload: parsed as InitPayload }); break;
            case "updates":
            case "update":  dispatch({ type: "update", chunk: parsed as UpdateChunk }); break;
            case "custom":  dispatch({ type: "custom", payload: parsed as CustomPayload }); break;
            case "paused":  dispatch({ type: "paused", payload: parsed as PausedPayload }); break;
            case "done":    dispatch({ type: "done",   payload: parsed as DonePayload }); break;
            case "error":   dispatch({ type: "error",  payload: parsed as ErrorPayload }); break;
            default: break;
          }
        }
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        dispatch({
          type: "error",
          payload: { message: (err as Error).message, type: (err as Error).name || "FetchError" },
        });
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const runScenario = useCallback(
    (name: string) => {
      dispatch({ type: "reset" });
      setSelectedNode(undefined);
      setActiveTab("timeline");
      void pumpStream(`${API_BASE}/scenarios/${name}/run`, {});
    },
    [pumpStream],
  );

  const respondHITL = useCallback(
    (approved: boolean) => {
      if (!incident.id) return;
      void pumpStream(`${API_BASE}/incidents/${incident.id}/approve/stream`, { approved });
    },
    [incident.id, pumpStream],
  );

  const selectedAgent =
    selectedNode != null ? incident.agents[selectedNode] : undefined;

  // Tabs reflect what's available — dot indicator when patch/report exist.
  const tabs: Tab[] = useMemo(() => [
    { id: "timeline", label: "Timeline",    Icon: Activity },
    { id: "graph",    label: "Graph",       Icon: GitBranch },
    { id: "patch",    label: "Code Patch",  Icon: ListChecks, hasContent: !!incident.codePatchResult },
    { id: "report",   label: "Post-Mortem", Icon: BookText,   hasContent: !!incident.postMortem },
  ], [incident.codePatchResult, incident.postMortem]);

  return (
    <div className="flex min-h-dvh flex-col bg-bg text-fg">
      <Header />

      <main className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col gap-4 px-6 py-6">
        {/* Scenario picker — always at the top so re-running is one click */}
        <section>
          <div className="mb-3 flex items-end justify-between gap-4">
            <div>
              <h1 className="font-display text-xl font-semibold tracking-tight sm:text-2xl">
                Live demo
              </h1>
              <p className="mt-0.5 text-xs text-fg-muted sm:text-sm">
                Pick a failure mode — Sentinel injects it and streams every agent live.
              </p>
            </div>
          </div>
          <DemoLauncher onRun={runScenario} disabled={busy && incident.status === "streaming"} />
        </section>

        {/* Incident status bar — appears when something is happening */}
        {incident.status !== "idle" && <IncidentHeader incident={incident} />}

        {/* Sticky HITL — pinned to the top of the dashboard area */}
        <AnimatePresence>
          {incident.status === "paused" && incident.paused && (
            <StickyHITLBanner
              paused={incident.paused}
              onDecision={respondHITL}
              busy={busy}
            />
          )}
        </AnimatePresence>

        {/* Dashboard — left rail (agents) + tabbed center pane */}
        <section className="
          grid min-h-[640px] flex-1 grid-cols-1 gap-4
          lg:grid-cols-[260px_1fr]
        ">
          <AgentList
            incident={incident}
            onSelect={setSelectedNode}
            selected={selectedNode}
          />

          <div className="flex flex-col overflow-hidden rounded-xl border border-line bg-bg-elev shadow-[var(--shadow-card)]">
            <TabBar tabs={tabs} active={activeTab} onChange={id => setActiveTab(id as TabId)} />
            <div className="flex-1 overflow-hidden">
              {activeTab === "timeline" && (
                <TimelineFeed
                  incident={incident}
                  filter={FILTERS.topLevel}
                />
              )}
              {activeTab === "graph" && (
                <div className="h-full p-3">
                  <AgentGraph
                    incident={incident}
                    onNodeClick={setSelectedNode}
                    selected={selectedNode}
                  />
                </div>
              )}
              {activeTab === "patch" && (
                <PatchTabContent incident={incident} />
              )}
              {activeTab === "report" && (
                incident.postMortem
                  ? <div className="p-4 overflow-y-auto h-full"><PostMortemPanel markdown={incident.postMortem} /></div>
                  : <EmptyTab label="Post-mortem will appear here when the incident is finalized." />
              )}
            </div>
          </div>
        </section>
      </main>

      <AgentDetail agent={selectedAgent} onClose={() => setSelectedNode(undefined)} />
    </div>
  );
}

function EmptyTab({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <p className="text-sm text-fg-muted">{label}</p>
    </div>
  );
}

// Code Patch tab — composed of (1) a live sub-graph progress stream
// (code_fixer + sandbox_verifier events, the same ones we filtered OUT
// of the main timeline) at top, and (2) the result panel below when
// the sub-graph has produced its CodePatchResult. Either can be empty
// in isolation; we show whichever has content.
function PatchTabContent({ incident }: { incident: { codePatchResult?: unknown; agents: Record<string, { progress: unknown[] }> } }) {
  // Detect if the sub-graph has emitted ANY event so we know whether to
  // show the live progress section or just an empty-state.
  const hasSubgraphActivity =
    (incident.agents["code_fixer"]?.progress.length ?? 0) > 0 ||
    (incident.agents["sandbox_verifier"]?.progress.length ?? 0) > 0;

  if (!hasSubgraphActivity && !incident.codePatchResult) {
    return (
      <EmptyTab label="Code patch will appear here once the sub-graph runs." />
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Top half: live sub-graph progress (code_fixer + sandbox_verifier) */}
      <div className="flex min-h-0 flex-1 flex-col border-b border-line">
        <div className="border-b border-line bg-bg-subtle/40 px-4 py-2">
          <span className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">
            Sub-graph live feed · code_fixer + sandbox_verifier
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          <TimelineFeed
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            incident={incident as any}
            filter={FILTERS.subgraphOnly}
            emptyState={{
              title: "Sub-graph not started",
              subtitle: "Will populate once the executor dispatches to code_patch.",
            }}
          />
        </div>
      </div>

      {/* Bottom: result panel — only when codePatchResult lands */}
      {incident.codePatchResult ? (
        <div className="max-h-[50%] overflow-y-auto p-4">
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          <CodePatchPanel result={incident.codePatchResult as any} />
        </div>
      ) : (
        <div className="border-t border-line bg-bg-subtle/40 px-4 py-3 text-center">
          <span className="font-mono text-[10px] uppercase tracking-wider text-fg-subtle">
            Result panel will appear here when the sub-graph completes
          </span>
        </div>
      )}
    </div>
  );
}
