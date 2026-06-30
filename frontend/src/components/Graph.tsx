import { useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D, { ForceGraphMethods } from "react-force-graph-2d";
import { forceCollide } from "d3-force";
import type { GraphData } from "../api";

interface Props {
  data: GraphData;
  width: number;
  height: number;
}

// Neon cluster colors (one per seed, in order).
const PALETTE = [
  "#ff4d8d", "#36d6ff", "#ffc83d", "#5dff9b",
  "#b478ff", "#ff9145", "#3df0cf", "#ff6ad5",
];
const BRIDGE_COLOR = "#9aa0c0";

function endpointId(end: any): string {
  return typeof end === "object" ? end.id : end;
}

function hexToRgba(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

function roundRect(ctx: any, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
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
  const clusterColor = useMemo(() => {
    const map: Record<string, string> = {};
    [...seedIds].forEach((id, i) => (map[id] = PALETTE[i % PALETTE.length]));
    return map;
  }, [seedIds]);

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

  const hexOf = (node: any): string =>
    node.kind === "bridge" ? BRIDGE_COLOR : clusterColor[node.cluster ?? ""] ?? "#36d6ff";

  const childOf = (l: any) => {
    const s = nodeById[endpointId(l.source)];
    const t = nodeById[endpointId(l.target)];
    return s?.kind === "seed" ? t : s;
  };
  const isConnectorLink = (l: any) => {
    const c = childOf(l);
    return !!c && (c.kind === "shared" || c.kind === "bridge");
  };

  const focus = useMemo(() => {
    if (!hovered) return null;
    const set = new Set<string>([hovered]);
    const direct = neighbors[hovered] ?? new Set<string>();
    direct.forEach((x) => set.add(x));
    if (nodeById[hovered]?.kind === "seed") {
      direct.forEach((mid) => {
        (neighbors[mid] ?? new Set<string>()).forEach((x) => {
          if (seedIds.has(x)) set.add(x);
        });
      });
    }
    return set;
  }, [hovered, neighbors, nodeById, seedIds]);

  const inFocus = (id: string) => !focus || focus.has(id);
  const linkOn = (l: any) =>
    !!focus && focus.has(endpointId(l.source)) && focus.has(endpointId(l.target));

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
      backgroundColor="rgba(0,0,0,0)"
      cooldownTicks={200}
      warmupTicks={60}
      onEngineStop={() => {
        if (!didFit.current) {
          fgRef.current?.zoomToFit(600, 70);
          didFit.current = true;
        }
      }}
      onNodeHover={(n: any) => setHovered(n ? n.id : null)}
      // ---- Neon edges: additive blending makes overlaps bloom ----
      linkCanvasObjectMode={() => "replace"}
      linkCanvasObject={(link: any, ctx: any) => {
        const s = link.source;
        const t = link.target;
        if (!s || !t || typeof s !== "object" || typeof t !== "object") return;
        const connector = isConnectorLink(link);

        let color: string;
        let width: number;
        if (focus) {
          if (!linkOn(link)) {
            color = "rgba(120,130,170,0.04)";
            width = 0.3;
          } else if (connector) {
            color = "rgba(255,255,255,0.95)";
            width = 2.2;
          } else {
            color = hexToRgba(hexOf(childOf(link)), 0.95);
            width = 1.8;
          }
        } else if (connector) {
          color = "rgba(225,232,255,0.55)";
          width = 0.8;
        } else {
          color = hexToRgba(hexOf(childOf(link)), 0.4);
          width = 0.7;
        }

        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(t.x, t.y);
        ctx.stroke();
        ctx.restore();
      }}
      // ---- Glowing orb nodes ----
      nodeCanvasObject={(node: any, ctx: any, scale: number) => {
        const focused = inFocus(node.id);
        const r = node.size;
        const hex = hexOf(node);

        ctx.save();
        ctx.globalAlpha = focused ? 1 : 0.14;

        // Colored halo.
        ctx.shadowColor = hex;
        ctx.shadowBlur = focused ? r * 2.2 : r * 0.6;

        // Sphere-like radial fill (bright core -> cluster color).
        const grad = ctx.createRadialGradient(
          node.x - r * 0.35,
          node.y - r * 0.35,
          r * 0.1,
          node.x,
          node.y,
          r
        );
        grad.addColorStop(0, "rgba(255,255,255,0.95)");
        grad.addColorStop(0.35, hex);
        grad.addColorStop(1, hexToRgba(hex, 0.85));
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
        ctx.fill();
        ctx.restore();

        if (node.id === hovered) {
          ctx.save();
          ctx.strokeStyle = "rgba(255,255,255,0.9)";
          ctx.lineWidth = 1.6 / scale;
          ctx.beginPath();
          ctx.arc(node.x, node.y, r + 2 / scale, 0, 2 * Math.PI);
          ctx.stroke();
          ctx.restore();
        }

        // Labels: seeds + shared at rest; all focused nodes on hover.
        const labelAtRest = node.kind === "seed" || node.kind === "shared";
        const showLabel = focus ? focused : labelAtRest;
        if (!showLabel) return;

        const fontSize = Math.max((node.kind === "seed" ? 13 : 11) / scale, 1.4);
        ctx.font = `${node.kind === "seed" ? "600 " : ""}${fontSize}px Inter, sans-serif`;
        const tw = ctx.measureText(node.name).width;
        const padX = 5 / scale;
        const padY = 3 / scale;
        const bx = node.x - tw / 2 - padX;
        const by = node.y + r + 3 / scale;
        const bw = tw + padX * 2;
        const bh = fontSize + padY * 2;

        ctx.save();
        roundRect(ctx, bx, by, bw, bh, 4 / scale);
        ctx.fillStyle = "rgba(8,10,20,0.72)";
        ctx.fill();
        if (node.kind === "seed") {
          ctx.strokeStyle = hexToRgba(hex, 0.9);
          ctx.lineWidth = 1 / scale;
          ctx.stroke();
        }
        ctx.fillStyle = node.kind === "bridge" ? "#aab0cc" : "#eef0ff";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(node.name, node.x, by + bh / 2);
        ctx.restore();
      }}
      nodePointerAreaPaint={(node: any, color: string, ctx: any) => {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.size + 3, 0, 2 * Math.PI);
        ctx.fill();
      }}
    />
  );
}
