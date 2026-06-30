"""Turn seed artists into a spaced-out, guaranteed-connected {nodes, links} graph.

Design (v2):
- Each seed shows up to DIRECT_PER_SEED of its strongest similar artists.
  Node size scales with match strength (strong match = big node).
- Artists similar to 2+ seeds become "shared" nodes — bigger, and they sit
  between clusters pulling them together.
- We TRY to link every pair of seeds. If two seeds share no neighbours
  (e.g. Steely Dan vs Quincy Jones), a meet-in-the-middle search digs outward
  from both until it finds a common artist, added as one small "bridge" node.
  The farther apart the seeds, the smaller/weaker the bridge. If no link can be
  found at all, that seed is simply left to float on its own — no fake edge.

Key idea: search breadth != display breadth. We fetch wide neighbourhoods to
*find* connections, but only *render* a handful per seed.
"""

import asyncio
import itertools

from lastfm_client import get_similar

DIRECT_PER_SEED = 5      # how many direct-similar artists we DISPLAY per seed
WIDE = 50                # how wide we FETCH a seed's neighbourhood (for finding bridges)
EXPAND_WIDTH = 20        # neighbourhood width when expanding during a bridge search
EXPAND_BRANCH = 12       # how many frontier nodes we expand per bridge step
MAX_HALF_DEPTH = 3       # hops we'll search out from EACH seed (so paths up to ~6 long)
FETCH_BUDGET = 170       # hard cap on live artist fetches per request
SHARED_CAP = 8           # keep only the top-N shared artists

# Node sizes (radius-ish units the frontend renders directly).
SEED_SIZE = 9.0


async def build_graph(seeds: list[str], direct_per_seed: int = DIRECT_PER_SEED) -> dict:
    builder = _Builder(seeds, direct_per_seed)
    return await builder.run()


class _Builder:
    def __init__(self, seeds: list[str], direct_per_seed: int):
        self.direct_per_seed = direct_per_seed
        self._display: dict[str, str] = {}      # lowercase key -> display name
        self._neighbor_cache: dict[str, list] = {}
        self._fetches = 0

        # Seed display names are exactly what the user typed.
        self.seed_keys = []
        for s in seeds:
            key = s.lower()
            self._display[key] = s
            if key not in self.seed_keys:
                self.seed_keys.append(key)

        self.nodes: dict[str, dict] = {}
        self.edges: list[dict] = []

    # --- Last.fm access (cached, budgeted) -------------------------------

    def _register(self, name: str) -> str:
        key = name.lower()
        self._display.setdefault(key, name)
        return key

    async def _neighbors(self, key: str, width: int = WIDE) -> list[tuple[str, float]]:
        """Return (key, match) neighbours of an artist, cached and budgeted."""
        if key in self._neighbor_cache:
            return self._neighbor_cache[key]
        if self._fetches >= FETCH_BUDGET:
            return []
        self._fetches += 1
        sims = await get_similar(self._display.get(key, key), width)
        out = [(self._register(name), match) for name, match in sims]
        self._neighbor_cache[key] = out
        return out

    # --- graph construction ----------------------------------------------

    def _add_node(self, key: str, kind: str, score: float) -> dict:
        node = self.nodes.get(key)
        if node is None:
            node = {"id": self._display[key], "name": self._display[key],
                    "kind": kind, "score": score}
            self.nodes[key] = node
        else:
            node["score"] = node.get("score", 0.0) + score
        return node

    async def run(self) -> dict:
        for sk in self.seed_keys:
            self.nodes[sk] = {"id": self._display[sk], "name": self._display[sk],
                              "kind": "seed", "score": 1.0}

        # Wide neighbourhoods for every seed, in parallel.
        wide_lists = await asyncio.gather(
            *(self._neighbors(sk, WIDE) for sk in self.seed_keys)
        )
        wide = dict(zip(self.seed_keys, wide_lists))

        self._add_direct(wide)
        self._add_shared(wide)
        await self._connect_all_seed_pairs()
        self._finalize_sizes()
        self._assign_clusters()
        return self._emit()

    def _add_direct(self, wide: dict) -> None:
        """Top-N strongest matches per seed become displayed 'direct' nodes."""
        for sk in self.seed_keys:
            top = sorted(wide[sk], key=lambda x: -x[1])[: self.direct_per_seed]
            for nk, match in top:
                if nk in self.seed_keys:
                    continue
                self._add_node(nk, "direct", match)
                self.edges.append({"source": self._display[sk],
                                   "target": self._display[nk], "weight": match})

    def _add_shared(self, wide: dict) -> None:
        """Artists in 2+ seeds' neighbourhoods are strong connectors."""
        appear: dict[str, dict[str, float]] = {}
        for sk, lst in wide.items():
            for nk, match in lst:
                if nk not in self.seed_keys:
                    appear.setdefault(nk, {})[sk] = match

        shared = {nk: sm for nk, sm in appear.items() if len(sm) >= 2}
        # Keep only the strongest shared connectors so the map stays clean.
        ranked = sorted(shared.items(), key=lambda kv: -sum(kv[1].values()))
        for nk, seed_matches in ranked[:SHARED_CAP]:
            node = self._add_node(nk, "shared", sum(seed_matches.values()))
            node["kind"] = "shared"
            for sk, match in seed_matches.items():
                self.edges.append({"source": self._display[sk],
                                   "target": self._display[nk], "weight": match})

    async def _connect_all_seed_pairs(self) -> None:
        """Ensure EVERY pair of seeds shares at least one direct connector.

        Not just one connected web — each seed must have its own relation to
        each other seed. We reuse an existing connector when one already links
        the pair (so we don't pile on redundant bridges), otherwise we dig one.
        """
        for sa, sb in itertools.combinations(self.seed_keys, 2):
            if self._pair_linked(sa, sb):
                continue
            bridge = await self._find_bridge(sa, sb)
            if bridge is not None:
                bk, depth = bridge
                if bk not in self.nodes:
                    self._add_node(bk, "bridge", 0.0)
                    self.nodes[bk]["kind"] = "bridge"
                    self.nodes[bk]["depth"] = depth
                weight = 1.0 / depth
                self._add_edge(sa, bk, weight, bridge=True)
                self._add_edge(bk, sb, weight, bridge=True)
            # If no bridge is found, we leave the pair unconnected on purpose —
            # a genuinely unlinkable seed just floats on its own.

    def _pair_linked(self, sa: str, sb: str) -> bool:
        """True if the two seeds already touch, or share a common connector."""
        adj = self._adjacency()
        na, nb = adj.get(sa, set()), adj.get(sb, set())
        if sb in na:
            return True
        return bool((na & nb) - {sa, sb})

    def _adjacency(self) -> dict:
        adj: dict[str, set] = {}
        for e in self.edges:
            a, b = e["source"].lower(), e["target"].lower()
            adj.setdefault(a, set()).add(b)
            adj.setdefault(b, set()).add(a)
        return adj

    def _add_edge(self, a_key: str, b_key: str, weight: float,
                  bridge: bool = False, dashed: bool = False) -> None:
        edge = {"source": self._display[a_key], "target": self._display[b_key],
                "weight": weight}
        if bridge:
            edge["bridge"] = True
        if dashed:
            edge["dashed"] = True
        self.edges.append(edge)

    async def _find_bridge(self, a: str, b: str):
        """Meet-in-the-middle search for a common artist linking a and b.

        Returns (bridge_key, combined_depth) or None. Lower combined depth means
        a closer (stronger) bridge.
        """
        seen_a = {a: 0}
        seen_b = {b: 0}
        frontier_a = [a]
        frontier_b = [b]

        def best_meet():
            common = set(seen_a) & set(seen_b)
            common -= {a, b}
            if not common:
                return None
            key = min(common, key=lambda k: seen_a[k] + seen_b[k])
            return key, seen_a[key] + seen_b[key]

        for depth in range(1, MAX_HALF_DEPTH + 1):
            frontier_a = await self._expand(frontier_a, seen_a, depth)
            meet = best_meet()
            if meet:
                return meet
            frontier_b = await self._expand(frontier_b, seen_b, depth)
            meet = best_meet()
            if meet:
                return meet
        return None

    async def _expand(self, frontier: list[str], seen: dict[str, int], depth: int) -> list[str]:
        # Fetch a whole frontier's neighbourhoods concurrently — serial awaits
        # here were the main cause of slow cold builds.
        targets = frontier[:EXPAND_BRANCH]
        results = await asyncio.gather(
            *(self._neighbors(node, EXPAND_WIDTH) for node in targets)
        )
        new_frontier: list[str] = []
        for res in results:
            for nk, _ in res:
                if nk not in seen:
                    seen[nk] = depth
                    new_frontier.append(nk)
        return new_frontier

    def _assign_clusters(self) -> None:
        """Tag each node with the seed it belongs to (its strongest seed link).

        The frontend colours nodes by cluster so groups read without tracing
        lines. Seeds belong to themselves; a shared/bridge node joins whichever
        seed it links to most strongly.
        """
        seed_displays = {self._display[sk]: sk for sk in self.seed_keys}
        best: dict[str, tuple[str, float]] = {}
        for e in self.edges:
            for a, b in ((e["source"], e["target"]), (e["target"], e["source"])):
                if a in seed_displays and b.lower() not in self.seed_keys:
                    bk = b.lower()
                    if bk not in best or e["weight"] > best[bk][1]:
                        best[bk] = (a, e["weight"])
        for key, node in self.nodes.items():
            if node["kind"] == "seed":
                node["cluster"] = node["id"]
            else:
                node["cluster"] = best.get(key, (None, 0.0))[0]

    def _finalize_sizes(self) -> None:
        for node in self.nodes.values():
            kind = node["kind"]
            if kind == "seed":
                node["size"] = SEED_SIZE
            elif kind == "shared":
                node["size"] = round(5.0 + min(node["score"], 2.0) * 2.0, 2)
            elif kind == "bridge":
                # Deeper bridge = smaller node = weaker connection.
                node["size"] = round(max(1.5, 4.0 - node.get("depth", 2) * 0.7), 2)
            else:  # direct
                node["size"] = round(3.0 + min(node["score"], 1.0) * 4.0, 2)

    def _emit(self) -> dict:
        # Dedupe edges by unordered pair, keeping the strongest weight.
        merged: dict[frozenset, dict] = {}
        for e in self.edges:
            pair = frozenset((e["source"], e["target"]))
            if pair in merged:
                kept = merged[pair]
                if e["weight"] > kept["weight"]:
                    kept["weight"] = e["weight"]
                kept["bridge"] = kept.get("bridge") and e.get("bridge")
                kept["dashed"] = kept.get("dashed") and e.get("dashed")
            else:
                merged[pair] = dict(e)

        node_ids = {n["id"] for n in self.nodes.values()}
        links = [e for e in merged.values()
                 if e["source"] in node_ids and e["target"] in node_ids]
        return {"nodes": list(self.nodes.values()), "links": links}
