"use client";

import { useEffect, useRef, useState } from "react";
import type { LocateResult } from "@/lib/countries";
import { formatPercent, heat, intensity } from "@/lib/heat";
import { WorldMap } from "./world-map";

type Entry = {
  id: number;
  query: string;
  result?: LocateResult;
  error?: string;
};

const SUGGESTIONS = [
  "Where was tango born?",
  "Best place to see the northern lights",
  "Football",
  "Where people speak Spanish",
  "Fjords and midnight sun",
  "Pierogi, borscht and vodka",
];

const RANKED_ROWS = 6;

export function Atlas() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [input, setInput] = useState("");
  const nextId = useRef(0);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const pending = entries.some((e) => !e.result && !e.error);
  const active = entries.find((e) => e.id === activeId)?.result;
  const probabilities = new Map(
    active?.ranked.map((r) => [r.name, r.probability]) ?? [],
  );

  useEffect(() => {
    logRef.current?.scrollTo({
      top: logRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [entries]);

  async function ask(query: string) {
    query = query.trim();
    if (!query || pending) return;

    const id = nextId.current++;
    setEntries((prev) => [...prev, { id, query }]);
    setInput("");

    const update = (patch: Partial<Entry>) =>
      setEntries((prev) =>
        prev.map((e) => (e.id === id ? { ...e, ...patch } : e)),
      );

    try {
      const res = await fetch("/api/locate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Something went wrong.");
      update({ result: data });
      setActiveId(id);
    } catch (error) {
      update({
        error: error instanceof Error ? error.message : "Something went wrong.",
      });
    } finally {
      inputRef.current?.focus();
    }
  }

  return (
    <main className="relative flex h-dvh flex-col lg:block">
      {/* Map */}
      <section className="relative min-h-0 flex-1 lg:absolute lg:inset-0 lg:pl-[440px]">
        <div className="flex h-full items-center justify-center px-4 pt-20 pb-4 lg:px-10 lg:pt-16 lg:pb-16">
          <WorldMap probabilities={probabilities} answerKey={activeId} />
        </div>

        <header className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-6 px-5 pt-5 lg:pl-[472px] lg:pr-8 lg:pt-7">
          <div className="lg:hidden">
            <Wordmark />
          </div>
          <div className="hidden min-w-0 lg:block">
            {active && (
              <p
                key={activeId}
                className="rise truncate pr-3 font-serif text-3xl leading-tight text-ink italic"
              >
                “{active.query}”
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

        <div
          ref={logRef}
          className="min-h-0 flex-1 space-y-7 overflow-y-auto px-5 py-5 lg:px-7"
        >
          {entries.length === 0 ? (
            <Intro onPick={ask} />
          ) : (
            entries.map((entry) => (
              <EntryView
                key={entry.id}
                entry={entry}
                active={entry.id === activeId}
                onSelect={() => entry.result && setActiveId(entry.id)}
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
              placeholder="Ask about any place, food, idea…"
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
    <div className="flex items-baseline gap-3">
      <h1 className="font-serif text-[34px] leading-none tracking-tight text-ink">
        Geo<span className="text-ember italic">jev</span>
      </h1>
      <span className="hidden font-mono text-[10px] tracking-[0.18em] whitespace-nowrap text-muted uppercase sm:inline">
        Ask the world
      </span>
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
        One request asks Jev a yes/no question about every country at once,
        and each gets its own calibrated probability. No text generated, just
        the map.
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
  const { result, error } = entry;

  return (
    <div className="rise">
      <p className="font-serif text-[22px] leading-snug text-ink">
        {entry.query}
      </p>

      {!result && !error && (
        <div className="mt-3 space-y-2">
          <div className="scan h-px w-full bg-hairline" />
          <p className="font-mono text-[11px] tracking-wider text-muted uppercase">
            Reading the world…
          </p>
        </div>
      )}

      {error && (
        <p className="mt-2 font-mono text-xs text-ember-deep">{error}</p>
      )}

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
              No country stands out for this one.
            </p>
          )}
          <ol className="space-y-1.5">
            {result.ranked.slice(0, RANKED_ROWS).map((r, i) => {
              return (
                <li
                  key={r.name}
                  className="grid grid-cols-[1.25rem_8.5rem_1fr_3rem] items-center gap-2 font-mono text-xs"
                >
                  <span className="text-muted">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="truncate text-ink">{r.name}</span>
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
              );
            })}
          </ol>
          <p className="mt-3 flex gap-3 font-mono text-[10px] tracking-wider text-muted uppercase">
            <span>
              {result.matches} {result.matches === 1 ? "match" : "matches"}
            </span>
            <span>{result.latencyMs}ms</span>
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
      <div className="hidden sm:block">{result ? `${result.model} · ${result.latencyMs}ms` : "Jev · TypeSafe"}</div>
    </div>
  );
}
