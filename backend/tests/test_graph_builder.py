"""Unit tests for graph_builder v2 (direct + shared + guaranteed bridges).

Last.fm is mocked via a canned neighbour table — no network, no API key.
"""

import asyncio

import graph_builder


def _fake_similar(table):
    async def _get_similar(artist, limit=15):
        return table.get(artist.lower(), [])[:limit]

    return _get_similar


def build(seeds, table, **kwargs):
    graph_builder.get_similar = _fake_similar(table)
    return asyncio.run(graph_builder.build_graph(seeds, **kwargs))


def _node(g, name):
    return next(n for n in g["nodes"] if n["name"].lower() == name.lower())


def _connected(g):
    """True if all seed nodes sit in one connected component."""
    adj = {}
    for l in g["links"]:
        adj.setdefault(l["source"], set()).add(l["target"])
        adj.setdefault(l["target"], set()).add(l["source"])
    seeds = [n["id"] for n in g["nodes"] if n["kind"] == "seed"]
    seen, stack = {seeds[0]}, [seeds[0]]
    while stack:
        for nxt in adj.get(stack.pop(), ()):
            if nxt not in seen:
                seen.add(nxt)
                stack.append(nxt)
    return all(s in seen for s in seeds)


def test_direct_neighbors_capped_per_seed():
    table = {"seed": [(f"A{i}", 1 - i / 100) for i in range(30)]}
    g = build(["Seed"], table, direct_per_seed=5)
    directs = [n for n in g["nodes"] if n["kind"] == "direct"]
    assert len(directs) == 5


def test_stronger_match_is_a_bigger_node():
    table = {"seed": [("Close", 0.95), ("Distant", 0.20)]}
    g = build(["Seed"], table)
    assert _node(g, "Close")["size"] > _node(g, "Distant")["size"]


def test_shared_artist_is_marked_shared_and_large():
    table = {
        "radiohead": [("Muse", 0.8), ("Portishead", 0.4)],
        "coldplay": [("Muse", 0.6), ("Keane", 0.5)],
    }
    g = build(["Radiohead", "Coldplay"], table)
    muse = _node(g, "Muse")
    assert muse["kind"] == "shared"
    # Shared (in both seeds) outsizes a single-seed direct neighbour.
    assert muse["size"] > _node(g, "Keane")["size"]


def test_disconnected_seeds_get_a_bridge():
    # Two seeds with NO shared neighbour, joined only through a stepping stone.
    table = {
        "left": [("Mid", 0.5)],
        "right": [("Mid", 0.5)],   # 'Mid' is similar to both -> shared, actually
    }
    # Make them genuinely disjoint at depth 1, meeting only at depth 2:
    table = {
        "left": [("LMid", 0.5)],
        "lmid": [("Common", 0.4)],
        "right": [("RMid", 0.5)],
        "rmid": [("Common", 0.4)],
    }
    g = build(["Left", "Right"], table)
    assert _connected(g)
    assert any(n["kind"] == "bridge" for n in g["nodes"])


def test_bridge_node_is_small():
    table = {
        "left": [("LMid", 0.5)],
        "lmid": [("Common", 0.4)],
        "right": [("RMid", 0.5)],
        "rmid": [("Common", 0.4)],
    }
    g = build(["Left", "Right"], table)
    bridge = next(n for n in g["nodes"] if n["kind"] == "bridge")
    direct = next(n for n in g["nodes"] if n["kind"] == "direct")
    assert bridge["size"] < direct["size"]


def test_every_seed_pair_ends_up_connected():
    table = {
        "a": [("A1", 0.6)],
        "b": [("B1", 0.6)],
        "c": [("C1", 0.6)],
        # disjoint clusters; only deep search can join them
        "a1": [("Hub", 0.3)],
        "b1": [("Hub", 0.3)],
        "c1": [("Hub", 0.3)],
    }
    g = build(["A", "B", "C"], table)
    assert _connected(g)


def _share_connector(g, a, b):
    """True if seeds a and b touch directly or share a common neighbour."""
    adj = {}
    for l in g["links"]:
        adj.setdefault(l["source"], set()).add(l["target"])
        adj.setdefault(l["target"], set()).add(l["source"])
    na, nb = adj.get(a, set()), adj.get(b, set())
    return b in na or bool((na & nb) - {a, b})


def test_every_seed_pair_shares_a_direct_connector():
    # Three clusters that meet only at a deep common hub.
    table = {
        "a": [("A1", 0.6)],
        "b": [("B1", 0.6)],
        "c": [("C1", 0.6)],
        "a1": [("Hub", 0.3)],
        "b1": [("Hub", 0.3)],
        "c1": [("Hub", 0.3)],
    }
    g = build(["A", "B", "C"], table)
    import itertools

    seeds = [n["id"] for n in g["nodes"] if n["kind"] == "seed"]
    for a, b in itertools.combinations(seeds, 2):
        assert _share_connector(g, a, b), f"{a} and {b} have no shared connector"
