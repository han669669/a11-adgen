export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(path, {
    method: init?.method ?? (init?.body ? "POST" : "GET"),
    headers: init?.body ? { "content-type": "application/json" } : undefined,
    body: init?.body ? JSON.stringify(init.body) : undefined,
    credentials: "same-origin",
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(data.error ?? `HTTP ${res.status}`, res.status);
  return data as T;
}

export interface Draft {
  key: string;
  url: string;
  rank: number | null;
  reason: string | null;
  picked: boolean;
}
export interface Final {
  id: string;
  status: string;
  error: string | null;
  images: { key: string; url: string }[];
  composed: { key: string; url: string } | null;
}
export interface Idea {
  id: string;
  n: number;
  format: "hook" | "anatomy" | "usvsthem" | "offer";
  insight: string;
  headline: string;
  picked: boolean;
  drafts: Draft[];
  finals: Final[];
}
export interface Batch {
  id: string;
  label: string;
  status: string;
  brand: { slug: string; name: string; kitVersion: number };
  ideas: Idea[];
  picks: { key: string; ideaId: string; note: string | null; finalRenderId: string | null }[];
}
export interface BatchRow {
  id: string;
  label: string;
  status: string;
  createdAt: string;
  brandSlug: string;
  brandName: string;
}
export interface Spend {
  month: string;
  capUsd: number;
  totalUsd: number;
}
