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
import { TimelineFeed } from "@/components/TimelineFeed";
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
              {activeTab === "timeline" && <TimelineFeed incident={incident} />}
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
                incident.codePatchResult
                  ? <div className="p-4 overflow-y-auto h-full"><CodePatchPanel result={incident.codePatchResult} /></div>
                  : <EmptyTab label="Code patch will appear here once the sub-graph runs." />
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
