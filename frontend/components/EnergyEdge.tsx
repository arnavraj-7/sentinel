"use client";

import { memo } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from "@xyflow/react";

// Custom edge: smooth bezier between source and target. Status-driven
// colour + dash pattern; NO moving dot (the user found the comet
// distracting and asked us to remove it across both the landing
// preview AND the live demo graph). The node fill alone is the cue
// for "this one is on now".

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

  const stroke =
    status === "active" ? "var(--running)" :
    status === "done"   ? "var(--success)" :
    status === "error"  ? "var(--danger)" :
                          "var(--line-strong)";

  const dasharray =
    status === "idle" ? "4 4" : "0";

  const strokeWidth =
    status === "idle"  ? 1.25 :
    status === "done"  ? 1.75 :
                         2;

  return (
    <>
      <BaseEdge
        id={`epath-${id}`}
        path={edgePath}
        style={{
          stroke,
          strokeWidth,
          strokeDasharray: dasharray,
          opacity: status === "idle" ? 0.55 : 1,
        }}
      />
      <EdgeLabelRenderer>
        <span style={{ display: "none" }} />
      </EdgeLabelRenderer>
    </>
  );
}

export const EnergyEdge = memo(EnergyEdgeImpl);
