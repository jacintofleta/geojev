"use client";

import { useEffect, useRef, useState } from "react";
import { WORLD, WORLD_MAP, type LocateResult } from "@/lib/countries";
import { scopeKey, type GeoMap, type Scope } from "@/lib/geo";
import { formatPercent, heat, intensity } from "@/lib/heat";
import { MapView } from "./map-view";

type Entry = {
  id: number;
  query: string;
  scope: Scope;
  result?: LocateResult;
  error?: string;
};

type Loaded = { status: "loading" } | { status: "ready"; map: GeoMap } | { status: "error" };

const SUGGESTIONS = [
  "Where was tango born?",
  "Best place to see the northern lights",
  "Football",
  "Where people speak Spanish",
  "Fjords and midnight sun",
  "Pierogi, borscht and vodka",
];

const RANKED_ROWS = 6;

function countryById(id: string) {
  return WORLD.countries.find((c) => c.name === id);
}

function levelsOf(iso3: string) {
  return WORLD.countries.find((c) => c.iso3 === iso3)?.levels ?? [];
}

export function Atlas() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [scope, setScope] = useState<Scope>(null);
  const [maps, setMaps] = useState<Record<string, Loaded>>({});
  const [input, setInput] = useState("");
  const nextId = useRef(0);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const key = scopeKey(scope);
  const loaded: Loaded = scope
    ? (maps[key] ?? { status: "loading" })
    : { status: "ready", map: WORLD_MAP };
  const pending = entries.some((e) => !e.result && !e.error);
  const activeEntry = entries.find((e) => e.id === activeId);
  // Only show an answer on the map it was asked about.
  const active =
    activeEntry && scopeKey(activeEntry.scope) === key ? activeEntry.result : undefined;
  const probabilities = new Map(active?.ranked.map((r) => [r.id, r.probability]) ?? []);

  useEffect(() => {
    logRef.current?.scrollTo({
      top: logRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [entries]);

  async function loadMap(next: Scope, force = false) {
    if (!next) return;
    const k = scopeKey(next);
    if (!force && maps[k] && maps[k].status !== "error") return;
    setMaps((prev) => ({ ...prev, [k]: { status: "loading" } }));
    try {
      const res = await fetch(`/api/regions/${next.iso3}/${next.level}`);
      if (!res.ok) throw new Error();
      const map: GeoMap = await res.json();
      setMaps((prev) => ({ ...prev, [k]: { status: "ready", map } }));
    } catch {
      setMaps((prev) => ({ ...prev, [k]: { status: "error" } }));
    }
  }

  async function ask(query: string, where: Scope = scope) {
    query = query.trim();
    if (!query || pending) return;

    const id = nextId.current++;
    setEntries((prev) => [...prev, { id, query, scope: where }]);
    setActiveId(id);
    setInput("");

    const update = (patch: Partial<Entry>) =>
      setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));

    try {
      const res = await fetch("/api/locate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, scope: where }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Something went wrong.");
      update({ result: data });
    } catch (error) {
      update({
        error: error instanceof Error ? error.message : "Something went wrong.",
      });
    } finally {
      inputRef.current?.focus();
    }
  }

  /**
   * Moves the map to the world or a country's regions. The question on screen
   * follows you: it's re-asked there unless it has already been answered.
   */
  function goTo(next: Scope) {
    setScope(next);
    loadMap(next);
    const query = activeEntry?.query;
    if (!query || pending) return;
    const existing = [...entries]
      .reverse()
      .find((e) => e.query === query && scopeKey(e.scope) === scopeKey(next) && !e.error);
    if (existing) setActiveId(existing.id);
    else ask(query, next);
  }

  function selectEntry(entry: Entry) {
    setActiveId(entry.id);
    setScope(entry.scope);
    loadMap(entry.scope);
  }

  return (
    <main className="relative flex h-dvh flex-col lg:block">
      {/* Map */}
      <section className="relative min-h-0 flex-1 lg:absolute lg:inset-0 lg:pl-[440px]">
        <div className="flex h-full items-center justify-center px-4 pt-28 pb-4 lg:px-10 lg:pt-32 lg:pb-16">
          {loaded.status === "ready" ? (
            <MapView
              key={key}
              map={loaded.map}
              probabilities={probabilities}
              answerKey={activeId}
              label={
                scope
                  ? `Map of ${scope.country}'s regions shaded by likelihood`
                  : "World map with countries shaded by likelihood"
              }
              {...(!scope && {
                canSelect: (f) => (countryById(f.id)?.levels.length ?? 0) > 0,
                onSelect: (f) => {
                  const country = countryById(f.id);
                  if (country?.iso3 && country.levels[0]) {
                    goTo({
                      iso3: country.iso3,
                      country: country.name,
                      level: country.levels[0].level,
                    });
                  }
                },
                selectHint: "Click to explore its regions",
              })}
            />
          ) : (
            <MapStatus
              failed={loaded.status === "error"}
              country={scope?.country ?? ""}
              onRetry={() => loadMap(scope, true)}
            />
          )}
        </div>

        <header className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-6 px-5 pt-5 lg:pl-[472px] lg:pr-8 lg:pt-7">
          <div className="min-w-0 space-y-2">
            <div className="lg:hidden">
              <Wordmark />
            </div>
            <ScopeBar scope={scope} onChange={goTo} />
            {activeEntry && (
              <p
                key={activeId}
                className="rise hidden truncate pr-3 font-serif text-3xl leading-tight text-ink italic lg:block"
              >
                “{activeEntry.query}”
              </p>
            )}
          </div>
          <Legend result={active} />
        </header>
      </section>

      {/* Chat */}
      <aside className="relative z-10 flex max-h-[55dvh] flex-col border-t border-hairline bg-paper-raised/80 backdrop-blur-md lg:absolute lg:inset-y-4 lg:left-4 lg:max-h-none lg:w-[420px] lg:rounded-[28px] lg:border lg:border-ink/10 lg:shadow-[0_1px_0_rgba(255,255,255,.7)_inset,0_30px_60px_-30px_rgba(60,40,20,.25)]">
        <div className="hidden px-7 pt-7 pb-2 lg:block">
          <Wordmark />
        </div>

        <div ref={logRef} className="min-h-0 flex-1 space-y-7 overflow-y-auto px-5 py-5 lg:px-7">
          {entries.length === 0 ? (
            <Intro onPick={(q) => ask(q)} />
          ) : (
            entries.map((entry) => (
              <EntryView
                key={entry.id}
                entry={entry}
                active={entry.id === activeId}
                onSelect={() => entry.result && selectEntry(entry)}
              />
            ))
          )}
        </div>

        <form
          className="p-3 lg:p-4"
          onSubmit={(event) => {
            event.preventDefault();
            ask(input);
          }}
        >
          <div className="flex items-center gap-2 rounded-full border border-ink/15 bg-paper py-1.5 pr-1.5 pl-5 transition focus-within:border-ink/40 focus-within:bg-white/60">
            <input
              ref={inputRef}
              autoFocus
              value={input}
              onChange={(e) => setInput(e.target.value)}
              maxLength={400}
              placeholder={
                scope ? `Ask about ${scope.country}'s regions…` : "Ask about any place, food, idea…"
              }
              aria-label="Ask Jev"
              className="min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-muted"
            />
            <button
              type="submit"
              disabled={!input.trim() || pending}
              aria-label="Send"
              className="grid size-9 shrink-0 place-items-center rounded-full bg-ink text-paper transition hover:bg-ember-deep disabled:bg-ink/15 disabled:text-ink/40"
            >
              <svg viewBox="0 0 16 16" className="size-4" fill="none">
                <path
                  d="M8 13V3M3.5 7.5 8 3l4.5 4.5"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
        </form>
      </aside>
    </main>
  );
}

function Wordmark() {
  return (
    <div className="flex items-center gap-2.5">
      <WorldMark />
      <h1 className="font-serif text-[34px] leading-none tracking-tight text-ink">
        Geo<span className="text-ember italic">jev</span>
      </h1>
    </div>
  );
}

/** Mapamundi mark: a graticule globe with an ember pin. */
function WorldMark() {
  return (
    <svg viewBox="0 0 32 32" className="size-8 shrink-0 text-ink" fill="none" aria-hidden>
      <g stroke="currentColor" strokeWidth="1.4">
        <circle cx="16" cy="16" r="13" />
        <ellipse cx="16" cy="16" rx="5.5" ry="13" />
        <path d="M16 3v26M3 16h26M5.2 9.5h21.6M5.2 22.5h21.6" strokeWidth="1" />
      </g>
      <circle cx="21.5" cy="11" r="3.2" className="fill-ember stroke-paper" strokeWidth="1.5" />
    </svg>
  );
}

/** Where the map is: World › Country, plus the country's administrative levels. */
function ScopeBar({ scope, onChange }: { scope: Scope; onChange: (scope: Scope) => void }) {
  const pill = "rounded-full border px-2.5 py-1 whitespace-nowrap transition";
  const idle =
    "border-ink/12 bg-paper-raised/70 text-ink/70 hover:border-ember hover:text-ember-deep";
  if (!scope) {
    return (
      <p className="font-mono text-[10px] tracking-wider text-muted uppercase">
        World · click a country to explore its regions
      </p>
    );
  }
  return (
    <nav className="pointer-events-auto flex flex-wrap items-center gap-1.5 font-mono text-[10px] tracking-wider uppercase">
      <button onClick={() => onChange(null)} className={`${pill} ${idle}`}>
        ← World
      </button>
      <span className="px-1 text-ink">{scope.country}</span>
      {levelsOf(scope.iso3).map(({ level, count }, i) =>
        level === scope.level ? (
          <span key={level} className={`${pill} border-ink bg-ink text-paper`}>
            Level {i + 1} · {count}
          </span>
        ) : (
          <button key={level} onClick={() => onChange({ ...scope, level })} className={`${pill} ${idle}`}>
            Level {i + 1} · {count}
          </button>
        ),
      )}
    </nav>
  );
}

function MapStatus({
  failed,
  country,
  onRetry,
}: {
  failed: boolean;
  country: string;
  onRetry: () => void;
}) {
  return (
    <div className="w-64 space-y-3 text-center">
      {failed ? (
        <>
          <p className="font-mono text-xs text-ember-deep">
            Couldn&apos;t load {country}&apos;s regions.
          </p>
          <button
            onClick={onRetry}
            className="font-mono text-[11px] tracking-wider text-ink uppercase underline"
          >
            Try again
          </button>
        </>
      ) : (
        <>
          <div className="scan h-px w-full bg-hairline" />
          <p className="font-mono text-[11px] tracking-wider text-muted uppercase">
            Drawing {country}&apos;s regions…
          </p>
        </>
      )}
    </div>
  );
}

function Intro({ onPick }: { onPick: (q: string) => void }) {
  return (
    <div className="rise space-y-6">
      <p className="font-serif text-[26px] leading-[1.15] text-ink">
        Type anything. Jev reads it and lights up the countries it{" "}
        <span className="text-ember italic">most likely</span> points to.
      </p>
      <p className="text-sm leading-relaxed text-muted">
        One request asks Jev a yes/no question about every country at once, and each gets its own
        calibrated probability. Click a country to ask about its regions instead.
      </p>
      <div className="flex flex-wrap gap-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            onClick={() => onPick(s)}
            className="rounded-full border border-ink/12 px-3.5 py-1.5 text-[13px] text-ink/80 transition hover:border-ember hover:text-ember-deep"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function EntryView({
  entry,
  active,
  onSelect,
}: {
  entry: Entry;
  active: boolean;
  onSelect: () => void;
}) {
  const { result, error, scope } = entry;
  const where = scope
    ? `${scope.country} · level ${levelsOf(scope.iso3).findIndex((l) => l.level === scope.level) + 1}`
    : null;

  return (
    <div className="rise">
      {where && (
        <p className="mb-1 font-mono text-[10px] tracking-wider text-ember-deep uppercase">
          {where}
        </p>
      )}
      <p className="font-serif text-[22px] leading-snug text-ink">{entry.query}</p>

      {!result && !error && (
        <div className="mt-3 space-y-2">
          <div className="scan h-px w-full bg-hairline" />
          <p className="font-mono text-[11px] tracking-wider text-muted uppercase">
            {scope ? `Reading ${scope.country}…` : "Reading the world…"}
          </p>
        </div>
      )}

      {error && <p className="mt-2 font-mono text-xs text-ember-deep">{error}</p>}

      {result && (
        <button
          onClick={onSelect}
          aria-pressed={active}
          className={`mt-3 block w-full rounded-2xl border p-3 text-left transition ${
            active
              ? "border-ink/15 bg-paper"
              : "border-transparent opacity-55 hover:border-ink/10 hover:opacity-100"
          }`}
        >
          {result.matches === 0 && (
            <p className="mb-2 text-xs text-muted italic">
              No {scope ? "region" : "country"} stands out for this one.
            </p>
          )}
          <ol className="space-y-1.5">
            {result.ranked.slice(0, RANKED_ROWS).map((r, i) => (
              <li
                key={r.id}
                className="grid grid-cols-[1.25rem_8.5rem_1fr_3rem] items-center gap-2 font-mono text-xs"
              >
                <span className="text-muted">{String(i + 1).padStart(2, "0")}</span>
                <span
                  className="truncate text-ink"
                  title={r.detail ? `${r.name}, ${r.detail}` : r.name}
                >
                  {r.name}
                </span>
                <span className="h-1.5 overflow-hidden rounded-full bg-ink/[0.06]">
                  <span
                    className="block h-full rounded-full transition-[width] duration-700"
                    style={{
                      width: `${Math.max(3, r.probability * 100)}%`,
                      background: heat(Math.max(0.05, intensity(r.probability))),
                    }}
                  />
                </span>
                <span className="text-right text-ink tabular-nums">
                  {formatPercent(r.probability)}
                </span>
              </li>
            ))}
          </ol>
          <p className="mt-3 flex gap-3 font-mono text-[10px] tracking-wider text-muted uppercase">
            <span>
              {result.matches} {result.matches === 1 ? "match" : "matches"}
            </span>
            <span>{result.cached ? "cached" : `${result.latencyMs}ms`}</span>
            <span className="truncate">{result.model}</span>
          </p>
        </button>
      )}
    </div>
  );
}

function Legend({ result }: { result?: LocateResult }) {
  return (
    <div className="shrink-0 space-y-1.5 text-right font-mono text-[10px] tracking-wider text-muted uppercase">
      <div className="flex items-center justify-end gap-2">
        <span>Less</span>
        <span
          className="h-1.5 w-16 rounded-full sm:w-28"
          style={{
            background: `linear-gradient(90deg, ${[0, 0.1, 0.3, 0.6, 1].map(heat).join(",")})`,
          }}
        />
        <span>More likely</span>
      </div>
      <div className="hidden sm:block">
        {result
          ? `${result.model} · ${result.cached ? "cached" : `${result.latencyMs}ms`}`
          : "Jev · TypeSafe"}
      </div>
    </div>
  );
}
