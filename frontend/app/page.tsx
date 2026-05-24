"use client";

import { useCallback, useReducer, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

import { AgentTimeline } from "@/components/AgentTimeline";
import { CodePatchPanel } from "@/components/CodePatchPanel";
import { DemoLauncher } from "@/components/DemoLauncher";
import { Header } from "@/components/Header";
import { HITLOverlay } from "@/components/HITLOverlay";
import { IncidentHeader } from "@/components/IncidentHeader";
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
  const abortRef = useRef<AbortController | null>(null);

  // ── Streaming pump ──
  // Consumes events from a single SSE leg and translates them into reducer
  // actions. One leg = one POST → server streams until interrupt() or END.
  const pumpStream = useCallback(
    async (url: string, body: object) => {
      // Cancel any prior stream — only one active at a time.
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
          // Each event's `data` is JSON. Tag dispatches by `event` name.
          let parsed: unknown;
          try {
            parsed = JSON.parse(evt.data);
          } catch {
            parsed = evt.data;
          }
          switch (evt.event) {
            case "init":    dispatch({ type: "init",   payload: parsed as InitPayload }); break;
            case "updates":
            case "update":  dispatch({ type: "update", chunk: parsed as UpdateChunk }); break;
            case "custom":  dispatch({ type: "custom", payload: parsed as CustomPayload }); break;
            case "paused":  dispatch({ type: "paused", payload: parsed as PausedPayload }); break;
            case "done":    dispatch({ type: "done",   payload: parsed as DonePayload }); break;
            case "error":   dispatch({ type: "error",  payload: parsed as ErrorPayload }); break;
            default:        /* ignore unknown event types */                                break;
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

  // ── Public actions ──
  const runScenario = useCallback(
    (name: string) => {
      dispatch({ type: "reset" });
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

  // ── Render ──
  return (
    <div className="flex min-h-dvh flex-col bg-bg text-fg">
      <Header />

      <main className="mx-auto w-full max-w-[1400px] flex-1 px-6 py-8">
        {/* Scenario launcher */}
        <section className="mb-8">
          <div className="mb-3 flex items-end justify-between">
            <div>
              <h1 className="font-display text-2xl font-bold tracking-tight">
                Run a scenario
              </h1>
              <p className="mt-1 text-sm text-fg-muted">
                Each one injects a different failure mode and streams Sentinel's
                response live — investigators, RCA, the code-patch sub-graph,
                and the differential test gate.
              </p>
            </div>
          </div>
          <DemoLauncher onRun={runScenario} disabled={busy && incident.status === "streaming"} />
        </section>

        {/* Live view */}
        <AnimatePresence>
          {incident.status !== "idle" && (
            <motion.section
              key={incident.id ?? "live"}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_minmax(0,420px)]"
            >
              {/* Left column — agent timeline */}
              <div className="space-y-4">
                <IncidentHeader incident={incident} />

                {incident.status === "paused" && incident.paused && (
                  <HITLOverlay
                    paused={incident.paused}
                    onDecision={respondHITL}
                    busy={busy}
                  />
                )}

                <AgentTimeline incident={incident} />
              </div>

              {/* Right column — artifacts (sticky on wide screens) */}
              <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
                {incident.codePatchResult && (
                  <CodePatchPanel result={incident.codePatchResult} />
                )}
                {incident.postMortem && (
                  <PostMortemPanel markdown={incident.postMortem} />
                )}
                {!incident.codePatchResult && !incident.postMortem && (
                  <div className="rounded-xl border border-dashed border-line bg-bg-elev/50 p-6 text-center text-xs text-fg-muted">
                    Artifacts (code patch, post-mortem) will appear here as
                    the graph produces them.
                  </div>
                )}
              </aside>
            </motion.section>
          )}
        </AnimatePresence>
      </main>

      <footer className="mt-auto border-t border-line py-4 text-center text-[11px] text-fg-subtle">
        Sentinel · LangGraph multi-agent · Gemini 2.5-Flash · Claude Code SDK
      </footer>
    </div>
  );
}
