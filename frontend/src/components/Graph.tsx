import { useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D, { ForceGraphMethods } from "react-force-graph-2d";
import { forceCollide } from "d3-force";
import type { GraphData } from "../api";

interface Props {
  data: GraphData;
  width: number;
  height: number;
}

// Distinct, pleasant cluster colors (one per seed, in order).
const PALETTE = [
  "#ff5c8a", "#5ad1ff", "#ffc24b", "#7ee787",
  "#c08bff", "#ff9d5c", "#4be8c0", "#f06aff",
];
const BRIDGE_COLOR = "#7a7a92";

function endpointId(end: any): string {
  return typeof end === "object" ? end.id : end;
}

export default function Graph({ data, width, height }: Props) {
  const fgRef = useRef<ForceGraphMethods>();
  const [hovered, setHovered] = useState<string | null>(null);

  const graph = useMemo(
    () => ({
      nodes: data.nodes.map((n) => ({ ...n })),
      links: data.links.map((l) => ({ ...l })),
    }),
    [data]
  );

  const nodeById = useMemo(
    () => Object.fromEntries(data.nodes.map((n) => [n.id, n])),
    [data]
  );
  const seedIds = useMemo(
    () => new Set(data.nodes.filter((n) => n.kind === "seed").map((n) => n.id)),
    [data]
  );

  // Map each cluster (seed id) to a palette color.
  const clusterColor = useMemo(() => {
    const map: Record<string, string> = {};
    [...seedIds].forEach((id, i) => (map[id] = PALETTE[i % PALETTE.length]));
    return map;
  }, [seedIds]);

  // Adjacency: node id -> set of connected node ids.
  const neighbors = useMemo(() => {
    const map: Record<string, Set<string>> = {};
    for (const l of data.links) {
      const s = endpointId(l.source);
      const t = endpointId(l.target);
      (map[s] ??= new Set()).add(t);
      (map[t] ??= new Set()).add(s);
    }
    return map;
  }, [data]);

  const colorOf = (node: any) =>
    node.kind === "bridge" ? BRIDGE_COLOR : clusterColor[node.cluster ?? ""] ?? "#5ad1ff";

  // The set of nodes in focus when something is hovered. For a SEED we extend
  // through connectors to the OTHER seeds, so the whole bridge path lights up.
  const focus = useMemo(() => {
    if (!hovered) return null;
    const set = new Set<string>([hovered]);
    const direct = neighbors[hovered] ?? new Set<string>();
    direct.forEach((x) => set.add(x));
    if (nodeById[hovered]?.kind === "seed") {
      direct.forEach((mid) => {
        (neighbors[mid] ?? new Set<string>()).forEach((x) => {
          if (seedIds.has(x)) set.add(x); // reach the destination seed
        });
      });
    }
    return set;
  }, [hovered, neighbors, nodeById, seedIds]);

  // The non-seed endpoint of a link (every link touches exactly one seed).
  const childOf = (l: any) => {
    const s = nodeById[endpointId(l.source)];
    const t = nodeById[endpointId(l.target)];
    return s?.kind === "seed" ? t : s;
  };

  // A "connector" link is part of a seed->seed path (via a shared or bridge
  // node) — these read as white. Everything else is a seed's own related artist.
  const isConnectorLink = (l: any) => {
    const c = childOf(l);
    return !!c && (c.kind === "shared" || c.kind === "bridge");
  };

  // Cluster tint for a related link, colored by its non-seed endpoint.
  const linkClusterColor = (l: any) => {
    const child = childOf(l);
    if (!child) return "#5ad1ff";
    return clusterColor[child.cluster ?? ""] ?? "#5ad1ff";
  };

  const inFocus = (id: string) => !focus || focus.has(id);
  const linkOn = (l: any) =>
    !!focus && focus.has(endpointId(l.source)) && focus.has(endpointId(l.target));

  // Re-fit the view to the graph once each new layout settles.
  const didFit = useRef(false);
  useEffect(() => {
    didFit.current = false;
    const fg = fgRef.current;
    if (!fg) return;
    fg.d3Force("charge")?.strength(-650);
    fg.d3Force("link")?.distance((l: any) => (l.bridge ? 240 : 120));
    fg.d3Force("collide", forceCollide((n: any) => n.size * 2 + 26));
    fg.d3ReheatSimulation();
  }, [graph]);

  return (
    <ForceGraph2D
      ref={fgRef as any}
      graphData={graph}
      width={width}
      height={height}
      backgroundColor="#0d0d12"
      cooldownTicks={200}
      warmupTicks={60}
      onEngineStop={() => {
        if (!didFit.current) {
          fgRef.current?.zoomToFit(600, 70);
          didFit.current = true;
        }
      }}
      onNodeHover={(n: any) => setHovered(n ? n.id : null)}
      linkCurvature={(l: any) => (l.bridge ? 0.3 : 0.12)}
      linkColor={(l: any) => {
        const connector = isConnectorLink(l);
        if (focus) {
          if (!linkOn(l)) return "rgba(140,140,170,0.04)";
          return connector ? "rgba(255,255,255,0.95)" : linkClusterColor(l) + "ee";
        }
        // At rest: white connectors stand out; related links faint cluster tint.
        return connector ? "rgba(235,235,245,0.28)" : linkClusterColor(l) + "26";
      }}
      linkWidth={(l: any) => {
        const connector = isConnectorLink(l);
        if (focus) {
          if (!linkOn(l)) return 0.3;
          return connector ? 2.4 : 1.5;
        }
        return connector ? 0.9 : 0.5 + l.weight * 2;
      }}
      linkLineDash={(l: any) => (l.dashed ? [4, 4] : null)}
      nodeCanvasObject={(node: any, ctx, scale) => {
        const focused = inFocus(node.id);
        const r = node.size;

        ctx.globalAlpha = focused ? (node.kind === "bridge" ? 0.8 : 1) : 0.12;
        ctx.beginPath();
        ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
        ctx.fillStyle = colorOf(node);
        ctx.fill();

        if (node.id === hovered) {
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 1.5 / scale;
          ctx.stroke();
        }
        ctx.globalAlpha = 1;

        // Labels: seeds + shared at rest; in focus mode, all focused nodes.
        const labelAtRest = node.kind === "seed" || node.kind === "shared";
        const showLabel = focus ? focused : labelAtRest;
        if (!showLabel) return;

        const fontSize = Math.max((node.kind === "seed" ? 13 : 11) / scale, 1.5);
        ctx.font = `${node.kind === "seed" ? "600 " : ""}${fontSize}px sans-serif`;
        ctx.fillStyle = node.kind === "bridge" ? "#9a9ab2" : "#e8e8f0";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText(node.name, node.x, node.y + r + 2);
      }}
      nodePointerAreaPaint={(node: any, color, ctx) => {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.size + 3, 0, 2 * Math.PI);
        ctx.fill();
      }}
    />
  );
}
