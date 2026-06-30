import { useState } from "react";

interface Props {
  seeds: string[];
  onChange: (seeds: string[]) => void;
  onBuild: () => void;
  loading: boolean;
}

// Search box with seed artists shown as removable chips.
export default function SeedInput({ seeds, onChange, onBuild, loading }: Props) {
  const [draft, setDraft] = useState("");

  function addSeed() {
    const name = draft.trim();
    if (name && !seeds.some((s) => s.toLowerCase() === name.toLowerCase())) {
      onChange([...seeds, name]);
    }
    setDraft("");
  }

  function removeSeed(name: string) {
    onChange(seeds.filter((s) => s !== name));
  }

  return (
    <div className="seed-input">
      <div className="seed-row">
        <input
          value={draft}
          placeholder="Add an artist…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addSeed()}
        />
        <button onClick={addSeed} disabled={!draft.trim()}>
          Add
        </button>
        <button
          className="build"
          onClick={onBuild}
          disabled={loading || seeds.length === 0}
        >
          {loading ? "Building…" : "Build map"}
        </button>
      </div>
      <div className="chips">
        {seeds.map((s) => (
          <span key={s} className="chip">
            {s}
            <button onClick={() => removeSeed(s)} aria-label={`Remove ${s}`}>
              ×
            </button>
          </span>
        ))}
      </div>
    </div>
  );
}
