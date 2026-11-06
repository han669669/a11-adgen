import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { api, SIGNED_OUT, type Spend } from "@/lib/api";
import { Batches } from "@/views/Batches";
import { Board } from "@/views/Board";
import { SignIn } from "@/views/SignIn";

function useHash() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const on = () => setHash(location.hash);
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  return hash;
}

export function App() {
  const [me, setMe] = useState<string | null | undefined>(undefined);
  const [spend, setSpend] = useState<Spend | null>(null);
  const [outError, setOutError] = useState<string | null>(null);
  const hash = useHash();

  const check = useCallback(() => {
    api<{ email: string }>("/api/me").then(
      (r) => setMe(r.email),
      () => setMe(null),
    );
  }, []);
  useEffect(check, [check]);
  useEffect(() => {
    const out = () => setMe(null);
    addEventListener(SIGNED_OUT, out);
    return () => removeEventListener(SIGNED_OUT, out);
  }, []);
  const loadSpend = useCallback(() => {
    api<Spend>("/api/spend").then(setSpend, () => setSpend(null));
  }, []);
  useEffect(() => {
    if (me) loadSpend();
  }, [me, hash, loadSpend]);

  if (me === undefined) return null;
  if (me === null) return <SignIn onDone={check} />;

  const board = hash.match(/^#\/b\/([0-9a-f-]{36})$/);
  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <nav className="mb-8 flex items-center justify-between gap-4">
        <a href="#/" className="whitespace-nowrap text-subtitle font-semibold">
          a11 adgen
        </a>
        <div className="flex items-center gap-3">
          {spend && (
            <span className="hidden text-caption text-muted-foreground sm:inline">
              Spend {spend.month}: US${spend.totalUsd.toFixed(2)} of US${spend.capUsd.toFixed(2)}
            </span>
          )}
          <Button
            variant="ghost"
            size="compact"
            onClick={async () => {
              setOutError(null);
              try {
                await api("/api/logout", { body: {} });
                setMe(null);
              } catch (e) {
                setOutError(`Sign-out failed: ${(e as Error).message}`);
              }
            }}
          >
            Sign out
          </Button>
        </div>
      </nav>
      {outError && (
        <p role="alert" className="mb-4 text-body text-red-700">
          {outError}
        </p>
      )}
      {board ? <Board key={board[1]} id={board[1]!} onSpend={loadSpend} /> : <Batches />}
    </div>
  );
}
