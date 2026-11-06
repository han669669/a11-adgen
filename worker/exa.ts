import type { Env } from "./env";
import { PRICE, reserve, settle } from "./spend";

const EXA = "https://api.exa.ai";

async function exaPost(env: Env, path: string, body: unknown): Promise<any> {
  if (!env.EXA_API_KEY) throw new Error("EXA_API_KEY is not set on the Worker.");
  const res = await fetch(`${EXA}${path}`, {
    method: "POST",
    headers: { "x-api-key": env.EXA_API_KEY, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`Exa ${path} failed: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
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
    await settle(env, spendId, false);
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
    await settle(env, spendId, false);
    throw e;
  }
}
