import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { api, type Batch, type Final, type Idea } from "@/lib/api";

const FORMAT: Record<Idea["format"], string> = { hook: "The Hook", anatomy: "The Anatomy", usvsthem: "Us vs Them", offer: "The Offer" };
const FINAL_USD = 0.08;
const MAX_RENDER = 8; // the render API takes 1 to 8 picks per tap

/** The first choice: the owner's saved picks, else the critic's top draft for each picked idea (D2). */
function initialPicks(batch: Batch): Map<string, string> {
  if (batch.picks.length > 0) return new Map(batch.picks.map((p) => [p.key, p.note ?? ""]));
  const out = new Map<string, string>();
  for (const idea of batch.ideas) {
    const top = idea.picked ? idea.drafts.find((d) => d.rank === 1) : undefined;
    if (top) out.set(top.key, "");
  }
  return out;
}

export function Board({ id }: { id: string }) {
  const [batch, setBatch] = useState<Batch | null>(null);
  const [picks, setPicks] = useState<Map<string, string>>(new Map());
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (resetPicks: boolean) => {
    try {
      const b = await api<Batch>(`/api/batches/${id}`);
      setBatch(b);
      if (resetPicks) setPicks(initialPicks(b));
    } catch (e) {
      // Only the first load replaces the page; a failed background refresh keeps the board.
      if (resetPicks) setLoadError((e as Error).message);
    }
  }, [id]);

  useEffect(() => {
    void load(true);
  }, [load]);

  // Finals: poll each running final; a finished final gets the real logo drawn once (server side).
  const pending = useMemo(
    () =>
      (batch?.ideas ?? [])
        .flatMap((i) => i.finals)
        .filter((f) => f.status === "queued" || (f.status === "done" && !f.composed && !f.composeError)),
    [batch],
  );
  useEffect(() => {
    if (pending.length === 0) return;
    const t = setTimeout(async () => {
      await Promise.allSettled(pending.map((f) => api(`/api/renders/${f.id}/refresh`, { body: {} })));
      await load(false);
    }, 8000);
    return () => clearTimeout(t);
  }, [pending, load]);

  if (loadError) return <p className="text-body text-red-700">{loadError}</p>;
  if (!batch) return <p className="text-body text-muted-foreground">Loading…</p>;

  const started = new Set(batch.picks.filter((p) => p.finalRenderId).map((p) => p.key));
  const toRender = [...picks.keys()].filter((k) => !started.has(k));
  const ideas = batch.ideas.filter((i) => i.drafts.length > 0).sort((a, b) => Number(b.picked) - Number(a.picked) || a.n - b.n);

  function toggle(key: string) {
    if (started.has(key)) return;
    setPicks((prev) => {
      const next = new Map(prev);
      if (next.has(key)) next.delete(key);
      else if ([...next.keys()].filter((k) => !started.has(k)).length < MAX_RENDER) next.set(key, "");
      return next;
    });
  }

  async function render() {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ results: { key: string; ok: boolean; error?: string }[] }>(`/api/batches/${id}/render`, {
        body: { picks: toRender.map((key) => ({ key, note: picks.get(key) || undefined })) },
      });
      const failed = res.results.filter((r) => !r.ok);
      if (failed.length) setError(failed.map((f) => f.error).join(" "));
      await load(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pb-28">
      <header className="mb-6">
        <p className="text-caption uppercase tracking-wide text-muted-foreground">{batch.brand.name}</p>
        <h1 className="text-display font-semibold tracking-tight">{batch.label}</h1>
        <p className="mt-1 text-body text-muted-foreground">
          Tap the drafts to render at high quality. The critic's top draft for each idea is already chosen.
        </p>
      </header>

      {ideas.length === 0 && <p className="text-body text-muted-foreground">No drafts yet.</p>}

      <div className="flex flex-col gap-8">
        {ideas.map((idea) => (
          <section key={idea.id} aria-labelledby={`idea-${idea.id}`}>
            <div className="mb-3 flex flex-wrap items-baseline gap-2">
              <Badge variant={idea.picked ? "solid" : "dot"}>{FORMAT[idea.format]}</Badge>
              <h2 id={`idea-${idea.id}`} className="text-title font-semibold">
                {idea.headline}
              </h2>
            </div>
            <p className="mb-3 max-w-2xl text-body text-muted-foreground">{idea.insight}</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {idea.drafts.map((d) => {
                const on = picks.has(d.key);
                const locked = started.has(d.key);
                return (
                  <figure key={d.key} className="flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={() => toggle(d.key)}
                      aria-pressed={on}
                      className={`relative overflow-hidden rounded-lg border-2 transition-colors ${on ? "border-foreground" : "border-transparent"} ${locked ? "cursor-default" : ""}`}
                    >
                      <img src={d.url} alt={`Draft for ${idea.headline}`} loading="lazy" className="aspect-[4/5] w-full object-cover" />
                      <span className="absolute left-2 top-2 flex items-center gap-2">
                        <span className="pointer-events-none rounded-md bg-background/90 px-1.5 py-0.5">
                          <Checkbox checked={on} tabIndex={-1} aria-hidden />
                        </span>
                        {d.rank && <span className="rounded-md bg-background/90 px-1.5 py-0.5 text-caption font-medium">#{d.rank}</span>}
                      </span>
                    </button>
                    {d.reason && <figcaption className="text-caption text-muted-foreground">{d.reason}</figcaption>}
                    {on && !locked && (
                      <Textarea
                        placeholder="Note for the final (optional)"
                        rows={2}
                        value={picks.get(d.key) ?? ""}
                        onChange={(e) => setPicks((prev) => new Map(prev).set(d.key, e.target.value))}
                      />
                    )}
                  </figure>
                );
              })}
            </div>
            {idea.finals.length > 0 && <Finals finals={idea.finals} />}
          </section>
        ))}
      </div>

      <div className="fixed inset-x-0 bottom-0 border-t border-border bg-background/95 px-4 py-3 backdrop-blur">
        {error && (
          <p role="alert" className="mx-auto mb-2 max-w-5xl text-body text-red-700">
            {error}
          </p>
        )}
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
          <p className="text-body text-muted-foreground">
            {toRender.length === 0 ? "Nothing new to render." : `${toRender.length} final${toRender.length > 1 ? "s" : ""}, about US$${(toRender.length * FINAL_USD).toFixed(2)}`}
          </p>
          <Button disabled={toRender.length === 0} loading={busy} onClick={render}>
            Render
          </Button>
        </div>
      </div>
    </div>
  );
}

function Finals({ finals }: { finals: Final[] }) {
  return (
    <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
      {finals.map((f) => {
        const img = f.composed ?? f.images[0];
        return (
          <figure key={f.id} className="flex flex-col gap-1">
            {img ? (
              <a href={img.url} target="_blank" rel="noreferrer">
                <img src={img.url} alt="Final" className="aspect-[4/5] w-full rounded-lg object-cover" />
              </a>
            ) : (
              <div className="flex aspect-[4/5] items-center justify-center rounded-lg bg-muted text-body text-muted-foreground">
                {f.status === "failed" ? "Failed" : "Rendering…"}
              </div>
            )}
            <figcaption className="text-caption text-muted-foreground">
              {f.status === "failed"
                ? f.error
                : f.composed
                  ? "Final with the real logo"
                  : f.composeError
                    ? `Logo step failed: ${f.composeError}`
                    : f.status === "done"
                      ? "Adding the logo…"
                      : "About 60 seconds"}
            </figcaption>
          </figure>
        );
      })}
    </div>
  );
}
