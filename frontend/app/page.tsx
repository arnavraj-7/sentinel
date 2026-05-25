"use client";

import { useCallback, useReducer, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowDown } from "lucide-react";

import { AgentDetail } from "@/components/AgentDetail";
import { AgentGraph } from "@/components/AgentGraph";
import { CodePatchPanel } from "@/components/CodePatchPanel";
import { DemoLauncher } from "@/components/DemoLauncher";
import { Header } from "@/components/Header";
import { Hero } from "@/components/Hero";
import { HITLOverlay } from "@/components/HITLOverlay";
import { IncidentHeader } from "@/components/IncidentHeader";
import { LiveTrail } from "@/components/LiveTrail";
import { PostMortemPanel } from "@/components/PostMortemPanel";
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

export default function Home() {
  const [incident, dispatch] = useReducer(incidentReducer, INITIAL_INCIDENT);
  const [busy, setBusy] = useState(false);
  const [selectedNode, setSelectedNode] = useState<string | undefined>();
  const abortRef = useRef<AbortController | null>(null);
  const liveRef = useRef<HTMLDivElement | null>(null);

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
      void pumpStream(`${API_BASE}/scenarios/${name}/run`, {});
      requestAnimationFrame(() => {
        liveRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
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

  return (
    <div className="flex min-h-dvh flex-col bg-bg text-fg">
      <Header />

      <main className="mx-auto w-full max-w-[1400px] flex-1 px-6 py-8">
        {/* Hero — only shown until something is happening, then it gets out
            of the way to give the graph the spotlight. */}
        <AnimatePresence>
          {incident.status === "idle" && (
            <motion.div
              initial={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0, marginBottom: 0 }}
              transition={{ duration: 0.35 }}
              className="mb-10"
            >
              <Hero />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Demo launcher */}
        <section>
          <div className="mb-4 flex items-end justify-between gap-4">
            <div>
              <h2 className="font-display text-xl font-semibold tracking-tight">
                Run a demo scenario
              </h2>
              <p className="mt-1 text-sm text-fg-muted">
                Pick a failure mode — Sentinel injects it, fires the alert, and
                the graph below comes alive.
              </p>
            </div>
            {incident.status !== "idle" && (
              <button
                type="button"
                onClick={() => liveRef.current?.scrollIntoView({ behavior: "smooth" })}
                className="
                  hidden sm:inline-flex items-center gap-1.5 rounded-md
                  border border-line bg-bg-elev px-3 py-1.5
                  text-xs font-medium text-fg-muted
                  transition-colors hover:text-fg
                "
              >
                <ArrowDown size={12} />
                Jump to graph
              </button>
            )}
          </div>
          <DemoLauncher onRun={runScenario} disabled={busy && incident.status === "streaming"} />
        </section>

        {/* Graph + live trail — always visible. Status drives it. */}
        <div ref={liveRef} className="mt-10 scroll-mt-20 space-y-4">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h2 className="font-display text-xl font-semibold tracking-tight">
                Agent graph
              </h2>
              <p className="mt-1 text-sm text-fg-muted">
                Click any node for full details — thinking, findings, activity log.
                Watch the connecting edges light up as control flows.
              </p>
            </div>
            {incident.id && (
              <span className="font-mono text-[11px] text-fg-muted">
                {incident.id}
              </span>
            )}
          </div>

          {incident.status !== "idle" && <IncidentHeader incident={incident} />}

          <AgentGraph
            incident={incident}
            onNodeClick={setSelectedNode}
            selected={selectedNode}
          />

          <LiveTrail incident={incident} />
        </div>

        {/* HITL gate + artifacts — appear when relevant. */}
        <AnimatePresence>
          {(incident.status === "paused" || incident.codePatchResult || incident.postMortem) && (
            <motion.section
              key="bottom-cards"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2"
            >
              {incident.status === "paused" && incident.paused && (
                <HITLOverlay
                  paused={incident.paused}
                  onDecision={respondHITL}
                  busy={busy}
                />
              )}
              {incident.codePatchResult && (
                <CodePatchPanel result={incident.codePatchResult} />
              )}
              {incident.postMortem && (
                <div className="lg:col-span-2">
                  <PostMortemPanel markdown={incident.postMortem} />
                </div>
              )}
            </motion.section>
          )}
        </AnimatePresence>
      </main>

      <footer className="mt-auto border-t border-line py-4 text-center text-[11px] text-fg-subtle">
        Sentinel · LangGraph · Gemini 2.5-Flash · Claude Code SDK
      </footer>

      {/* Click-a-node drawer */}
      <AgentDetail agent={selectedAgent} onClose={() => setSelectedNode(undefined)} />
    </div>
  );
}
