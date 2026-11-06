import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";

/** Email + password. Only allow-listed emails can make an account. */
export function SignIn({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/api/${mode}`, { body: mode === "signup" ? { email, password, code } : { email, password } });
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4">
      <h1 className="text-display font-semibold tracking-tight">a11 adgen</h1>
      <p className="mt-1 text-body text-muted-foreground">{mode === "login" ? "Sign in to pick this week's finals." : "Make your account with the set-up code you were given."}</p>
      <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
        <Field>
          <FieldLabel htmlFor="email">Email</FieldLabel>
          <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field>
          <FieldLabel htmlFor="password">Password</FieldLabel>
          <Input
            id="password"
            type="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            minLength={mode === "signup" ? 12 : undefined}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        {mode === "signup" && (
          <Field>
            <FieldLabel htmlFor="code">Set-up code</FieldLabel>
            <Input id="code" type="password" autoComplete="off" required value={code} onChange={(e) => setCode(e.target.value)} />
          </Field>
        )}
        {error && (
          <p role="alert" className="text-body text-red-700">
            {error}
          </p>
        )}
        <Button type="submit" loading={busy}>
          {mode === "login" ? "Sign in" : "Make account"}
        </Button>
      </form>
      <Button variant="ghost" className="mt-2 self-start" onClick={() => {
          setMode(mode === "login" ? "signup" : "login");
          setError(null);
        }}>
        {mode === "login" ? "First time? Make an account" : "Have an account? Sign in"}
      </Button>
    </main>
  );
}
