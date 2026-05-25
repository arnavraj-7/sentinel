"use client";

import { memo } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from "@xyflow/react";

// A custom edge that draws a smooth bezier between source and target,
// and — when `data.active === true` — overlays a glowing dot travelling
// from source to target along the same path (SVG <animateMotion>).
//
// "Done" edges render as solid coloured lines. "Idle" as dashed grey.
// The visual cue: the moving dot is the "ray of light" — you can see
// the graph thinking in real time.

export type EnergyEdgeData = {
  status: "idle" | "active" | "done" | "error";
};

function EnergyEdgeImpl(props: EdgeProps) {
  const {
    id,
    sourceX, sourceY, targetX, targetY,
    sourcePosition, targetPosition,
    data,
  } = props;
  const d = (data ?? {}) as EnergyEdgeData;
  const status = d.status ?? "idle";

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX, sourceY, targetX, targetY,
    sourcePosition, targetPosition,
    curvature: 0.4,
  });

  void labelX; void labelY;

  const strokeBase =
    status === "active" ? "var(--running)" :
    status === "done"   ? "var(--success)" :
    status === "error"  ? "var(--danger)" :
                          "var(--line-strong)";

  const dasharray =
    status === "idle"  ? "4 4" :
    status === "active" ? "0" :
                          "0";

  const pathId = `epath-${id}`;

  return (
    <>
      <BaseEdge
        id={pathId}
        path={edgePath}
        style={{
          stroke: strokeBase,
          strokeWidth: status === "idle" ? 1.25 : 2,
          strokeDasharray: dasharray,
          opacity: status === "idle" ? 0.6 : 1,
        }}
      />
      {status === "active" && (
        <>
          {/* Glow filter — defined inline; cheap enough for a handful of edges. */}
          <defs>
            <filter id={`glow-${id}`} x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <linearGradient id={`grad-${id}`}>
              <stop offset="0%"  stopColor="var(--info)" />
              <stop offset="100%" stopColor="var(--accent)" />
            </linearGradient>
          </defs>
          {/* Comet — circle following the edge path */}
          <circle
            r="3.5"
            fill={`url(#grad-${id})`}
            filter={`url(#glow-${id})`}
          >
            <animateMotion dur="1.4s" repeatCount="indefinite" rotate="auto" path={edgePath} />
          </circle>
          {/* A faint trailing dot for extra energy */}
          <circle
            r="2"
            fill="var(--running)"
            opacity="0.5"
          >
            <animateMotion dur="1.4s" begin="-0.18s" repeatCount="indefinite" rotate="auto" path={edgePath} />
          </circle>
        </>
      )}
      {/* invisible label slot — kept so EdgeLabelRenderer is referenced */}
      <EdgeLabelRenderer>
        <span style={{ display: "none" }} />
      </EdgeLabelRenderer>
    </>
  );
}

export const EnergyEdge = memo(EnergyEdgeImpl);
