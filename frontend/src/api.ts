// Talks to the FastAPI backend. Base URL is overridable for deployment.
const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

export type NodeKind = "seed" | "shared" | "direct" | "bridge";

export interface GraphNode {
  id: string;
  name: string;
  kind: NodeKind;
  size: number;
  score: number;
  depth?: number;
  cluster?: string | null;
}

export interface GraphLink {
  source: string;
  target: string;
  weight: number;
  bridge?: boolean;
  dashed?: boolean;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

export async function fetchGraph(seeds: string[]): Promise<GraphData> {
  const query = encodeURIComponent(seeds.join(","));
  const resp = await fetch(`${API_BASE}/api/graph?seeds=${query}`);
  if (!resp.ok) {
    const detail = await resp.json().catch(() => ({}));
    throw new Error(detail.detail ?? `Request failed (${resp.status})`);
  }
  return resp.json();
}
