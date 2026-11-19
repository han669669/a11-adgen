import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { api, SIGNED_OUT, type Spend } from "@/lib/api";
import { checkSession, type Session } from "@/lib/session";
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
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(false);
  const [spend, setSpend] = useState<Spend | null>(null);
  const [outError, setOutError] = useState<string | null>(null);
  const hash = useHash();

  const check = useCallback(() => {
    setChecking(true);
    void checkSession().then((next) => {
      setSession(next);
      setChecking(false);
    });
  }, []);
  useEffect(check, [check]);
  useEffect(() => {
    const out = () => setSession({ status: "signed-out" });
    addEventListener(SIGNED_OUT, out);
    return () => removeEventListener(SIGNED_OUT, out);
  }, []);
  const loadSpend = useCallback(() => {
    api<Spend>("/api/spend").then(setSpend, () => setSpend(null));
  }, []);
  useEffect(() => {
    if (session?.status === "signed-in") loadSpend();
  }, [session, hash, loadSpend]);

  if (session === null) return null;
  if (session.status === "signed-out") return <SignIn onDone={check} />;
  if (session.status === "error") return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4">
      <h1 className="text-display font-semibold tracking-tight">a11 adgen</h1>
      <p role="alert" className="mt-1 text-body text-muted-foreground">
        We couldn't check your session. Please try again.
      </p>
      <Button className="mt-6" loading={checking} onClick={check}>Retry</Button>
    </main>
  );

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
                setSession({ status: "signed-out" });
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
