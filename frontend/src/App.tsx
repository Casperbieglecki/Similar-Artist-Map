import { useEffect, useState } from "react";
import SeedInput from "./components/SeedInput";
import Graph from "./components/Graph";
import { fetchGraph, type GraphData } from "./api";

export default function App() {
  const [seeds, setSeeds] = useState<string[]>([]);
  const [data, setData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });

  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  async function build() {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchGraph(seeds));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="app">
      <header>
        <h1>Artist Map</h1>
        <p className="tagline">Drop in a few artists. See who orbits them.</p>
        <SeedInput
          seeds={seeds}
          onChange={setSeeds}
          onBuild={build}
          loading={loading}
        />
        {error && <p className="error">{error}</p>}
        {data && data.nodes.length > 0 && (
          <p className="hint">Hover an artist to focus · white lines link seeds to each other · colored lines are a seed's own similar artists</p>
        )}
      </header>

      <main>
        {data && data.nodes.length > 0 ? (
          <Graph data={data} width={size.w} height={size.h} />
        ) : (
          !loading && (
            <div className="empty">
              {data ? "No similar artists found — try another." : "Your map will appear here."}
            </div>
          )
        )}
      </main>
    </div>
  );
}
