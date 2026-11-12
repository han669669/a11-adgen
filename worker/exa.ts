import type { Env } from "./env";
import { NotBilledError, PRICE, reserve, settle } from "./spend";

const EXA = "https://api.exa.ai";

async function exaPost(env: Env, path: string, body: unknown): Promise<any> {
  if (!env.EXA_API_KEY) throw new NotBilledError("EXA_API_KEY is not set on the Worker.");
  const res = await fetch(`${EXA}${path}`, {
    method: "POST",
    headers: { "x-api-key": env.EXA_API_KEY, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) {
    const message = `Exa ${path} failed: HTTP ${res.status} ${(await res.text().catch(() => "")).slice(0, 300)}`;
    // Exa's error page (read 2026-11-12): a 503 is "not processed and is not billed". A 4xx refuses the request.
    // A 500 or a 504 (the request passed its deadline) may be billed: it stays counted.
    throw (res.status >= 400 && res.status < 500) || res.status === 503 ? new NotBilledError(message) : new Error(message);
  }
  return res.json();
}

export interface SearchInput {
  query: string;
  numResults: number;
  type: "auto" | "lite";
  includeDomains?: string[];
  startPublishedDate?: string;
}

export async function search(env: Env, input: SearchInput) {
  const usd = input.type === "lite" ? PRICE.exaSearchLite : PRICE.exaSearch;
  const spendId = await reserve(env, "exa", "search", input.query, usd);
  try {
    const data = await exaPost(env, "/search", {
      query: input.query,
      type: input.type,
      numResults: input.numResults,
      ...(input.includeDomains?.length ? { includeDomains: input.includeDomains } : {}),
      ...(input.startPublishedDate ? { startPublishedDate: input.startPublishedDate } : {}),
      contents: { highlights: true },
    });
    await settle(env, spendId, true);
    return (data.results ?? []).map((r: any) => ({
      title: r.title ?? null,
      url: r.url,
      publishedDate: r.publishedDate ?? null,
      highlights: r.highlights ?? [],
    }));
  } catch (e) {
    // A timeout or an answer that cannot be read may still be billed: only a sure refusal gives the money back.
    await settle(env, spendId, !(e instanceof NotBilledError));
    throw e;
  }
}

export async function contents(env: Env, urls: string[], maxCharacters: number) {
  const spendId = await reserve(env, "exa", "contents", urls.join(" "), PRICE.exaContentsPage * urls.length);
  try {
    const data = await exaPost(env, "/contents", { urls, text: { maxCharacters } });
    await settle(env, spendId, true);
    return (data.results ?? []).map((r: any) => ({
      url: r.url,
      title: r.title ?? null,
      text: r.text ?? "",
      image: r.image ?? null,
    }));
  } catch (e) {
    // A timeout or an answer that cannot be read may still be billed: only a sure refusal gives the money back.
    await settle(env, spendId, !(e instanceof NotBilledError));
    throw e;
  }
}
