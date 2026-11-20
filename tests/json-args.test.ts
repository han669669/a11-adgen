import { describe, expect, it } from "vitest";
import * as batch from "../worker/batch";
import type { Env } from "../worker/env";
import { handleMcp, TOOLS, toolInput } from "../worker/mcp";
import { decodeJsonArgs, InputError, type ObjectSchema } from "../worker/schema";
import { exampleBrief } from "./fixtures/brief";
import { addRender, approved, direction, draftCheck, E3, firstRound, type Idea, renderId, run, seeded, select } from "./helpers/engine3";

/**
 * Issue 142: an MCP client that cannot send a nested object (Cursor's dynamic tool wrapper sends it as null) can send
 * the object or array argument as JSON text. The server parses it before validate, and every check stays the same.
 */

const tool = (name: string) => TOOLS.find((t) => t.name === name)!;
const isContainer = (v: unknown) => v !== null && typeof v === "object";
/** Each top-level object or array argument as JSON text: what a client sends when it can pass only one level. */
const asText = (args: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(args).map(([k, v]) => [k, isContainer(v) ? JSON.stringify(v) : v]));
/** Every object and array at every level (not the arguments object) as JSON text inside JSON text. */
const deepText = (v: unknown): unknown => {
  if (!isContainer(v)) return v;
  const inner = Array.isArray(v) ? v.map((x) => textOf(x)) : Object.fromEntries(Object.entries(v as object).map(([k, x]) => [k, textOf(x)]));
  return inner;
};
const textOf = (v: unknown): unknown => (isContainer(v) ? JSON.stringify(deepText(v)) : v);

const UUID = (n: number) => `${n}0000000-0000-4000-8000-000000000000`.slice(0, 36);
const ideas: Idea[] = Array.from({ length: 10 }, (_, i) => ({ id: UUID(i + 1), n: i + 1 }));
/** Real arguments of each tool that has nested objects (the tools in issue 142, and prompt_get). */
const CASES: [string, Record<string, unknown>][] = [
  ["brief_save", { batchId: E3, brief: exampleBrief(UUID(9), ["1"]), promptVersion: "0.2.10" }],
  ["ideas_save", firstRound()],
  ["ideas_pick", select(ideas)],
  ["direction_save", { batchId: E3, ideaId: ideas[0]!.id, direction: direction(), promptVersion: "0.2.15" }],
  ["checks_save", { batchId: E3, ideaId: ideas[0]!.id, kind: "draft_check", check: draftCheck(renderId(1, 1)), promptVersion: "0.2.16" }],
  [
    "brand_save",
    {
      slug: "wongi",
      name: "WonGi",
      kit: {
        logoUrl: "https://brand.example/logo.png",
        palette: [{ hex: "#F26A21", role: "logo orange" }],
        voice: "Warm, playful, short sentences.",
        refs: [{ url: "https://brand.example/closeup.jpg", label: "kernels close-up", role: "texture" }],
      },
    },
  ],
  ["prompt_get", { name: "pack", arguments: { batchId: "b1" } }],
];

describe("JSON text for object and array arguments", () => {
  it.each(CASES)("%s: JSON text at the top level and at every level gives the same checked arguments as objects", (name, args) => {
    const want = toolInput(tool(name), args);
    expect(toolInput(tool(name), asText(args))).toEqual(want);
    expect(toolInput(tool(name), deepText(args))).toEqual(want);
  });

  it("parses JSON text for every top-level object and array argument of every tool", () => {
    let seen = 0;
    for (const t of TOOLS) {
      for (const [k, p] of Object.entries(t.inputSchema.properties)) {
        if (p.type !== "object" && p.type !== "array") continue;
        seen++;
        expect(decodeJsonArgs(t.inputSchema, { [k]: p.type === "object" ? "{}" : "[]" }), `${t.name}.${k}`).toEqual({ [k]: p.type === "object" ? {} : [] });
      }
    }
    expect(seen).toBeGreaterThan(10);
  });

  it("refuses bad JSON text and JSON text of the wrong shape with the usual errors", () => {
    const brief = tool("brief_save");
    const args = CASES[0]![1];
    expect(() => toolInput(brief, { ...args, brief: '{"brand": ' })).toThrow(new InputError("brief must be an object; the text given is not valid JSON."));
    expect(() => toolInput(tool("ideas_save"), { ...firstRound(), ideas: "not json" })).toThrow("ideas must be an array; the text given is not valid JSON.");
    // Valid JSON of the wrong type, a wrong field, and text inside text at the same level: validate refuses each as before.
    expect(() => toolInput(brief, { ...args, brief: "[]" })).toThrow("brief must be an object.");
    expect(() => toolInput(brief, { ...args, brief: JSON.stringify(JSON.stringify(args.brief)) })).toThrow("brief must be an object.");
    expect(() => toolInput(brief, { ...args, brief: JSON.stringify({ ...(args.brief as object), extra: 1 }) })).toThrow("Unknown argument: brief.extra.");
    // The null that Cursor's wrapper sends for a nested object is refused as before, not taken as empty.
    expect(() => toolInput(brief, { ...args, brief: { ...(args.brief as object), brand: null } })).toThrow("brief.brand must be an object.");
    // A nested error names its full path.
    const bad = { ...(args.brief as Record<string, unknown>), brand: "{oops" };
    expect(() => toolInput(brief, { ...args, brief: JSON.stringify(bad) })).toThrow("brief.brand must be an object; the text given is not valid JSON.");
  });

  it("never parses the arguments object itself or a string field, and never changes the input", () => {
    expect(() => toolInput(tool("brief_save"), JSON.stringify(CASES[0]![1]))).toThrow("Arguments must be an object.");
    // direction_save takes each plan as a string: JSON text there stays text.
    const d = direction();
    const out = toolInput(tool("direction_save"), { batchId: E3, ideaId: ideas[0]!.id, direction: JSON.stringify(d), promptVersion: "0.2.15" });
    expect(typeof (out.direction as { drafts: { plan: unknown }[] }).drafts[0]!.plan).toBe("string");
    const input = { batchId: E3, ideaId: ideas[0]!.id, direction: { ...d, mechanism: JSON.stringify(d.mechanism) } };
    const copy = structuredClone(input);
    decodeJsonArgs(tool("direction_save").inputSchema, input);
    expect(input).toEqual(copy);
  });

  it("keeps a __proto__ key as a key, so validate refuses it and no prototype changes", () => {
    const schema: ObjectSchema = {
      type: "object",
      properties: { o: { type: "object", properties: { a: { type: "string" } }, additionalProperties: false } },
      additionalProperties: false,
    };
    const decoded = decodeJsonArgs(schema, { o: '{"a":"x","__proto__":{"polluted":true}}' }) as { o: object };
    expect(Object.getPrototypeOf(decoded.o)).toBe(Object.prototype);
    expect(Object.keys(decoded.o)).toEqual(["a", "__proto__"]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(() => toolInput({ inputSchema: schema }, { o: '{"a":"x","__proto__":{"polluted":true}}' })).toThrow("Unknown argument: o.__proto__.");
  });
});

describe("an engine 3 batch with every object and array argument as JSON text", () => {
  it("saves the brief, the concepts, the review, the direction and a draft check, as the object form does", async () => {
    const s = await seeded({ brief: false });
    const brief = exampleBrief(s.subjectId, s.factIds);
    // The same third insight that seeded() adds, so the first-round territories match.
    brief.buyerInsights.push({ id: "i3", text: "People hide the pouch from the rest of the home.", tension: "Sharing is good; this pouch is mine.", basis: "hypothesis", evidenceIds: [], confidence: "low", market: "unknown" });
    expect(await run(s.env, "brief_save", asText({ batchId: E3, brief }))).toMatchObject({ version: 1, unverified: [] });
    expect((await batch.batchGet(s.env, E3)).brief!.brief).toMatchObject({ brand: brief.brand, product: brief.product });

    const saved = await run(s.env, "ideas_save", asText(firstRound()));
    expect(saved.ideas).toHaveLength(10);
    const got = saved.ideas as Idea[];
    expect(await run(s.env, "ideas_pick", asText(select(got)))).toMatchObject({ outcome: "select", picked: [got[0]!.id, got[3]!.id, got[6]!.id], reserves: [got[1]!.id, got[4]!.id], warnings: [], version: 1 });
    s.raw
      .prepare(`UPDATE ideas SET copy = json_set(copy, '$.ownerApproved', json_object('headline', headline, 'subline', json_extract(copy, '$.subline'))) WHERE batch_id = ? AND picked = 1`)
      .run(E3);
    const d = await run(s.env, "direction_save", asText({ batchId: E3, ideaId: got[0]!.id, direction: direction(), promptVersion: "0.2.15" }));
    expect(d).toMatchObject({ version: 1, warnings: [] });
    addRender(s.raw, renderId(1, 1), got[0]!.id);
    const c = await run(s.env, "checks_save", asText({ batchId: E3, ideaId: got[0]!.id, kind: "draft_check", check: draftCheck(renderId(1, 1)), promptVersion: "0.2.16" }));
    expect(c).toMatchObject({ version: 1 });
  });

  it("saves a brief and a direction read back with batch_get and sent again as JSON text (server fields dropped)", async () => {
    const { env, ideas: got } = await approved();
    const readBrief = (await batch.batchGet(env, E3)).brief!.brief as Record<string, unknown>;
    expect(JSON.stringify(readBrief)).toContain("retrievedAt");
    expect(await run(env, "brief_save", { batchId: E3, brief: JSON.stringify(readBrief) })).toMatchObject({ version: 2 });

    await run(env, "direction_save", { batchId: E3, ideaId: got[0]!.id, direction: direction(), promptVersion: "0.2.15" });
    const b = await run(env, "batch_get", { id: E3, withPlans: true });
    const full = b.ideas.find((x: { id: string }) => x.id === got[0]!.id).direction;
    expect(full).toHaveProperty("savedAt");
    const again = await run(env, "direction_save", { batchId: E3, ideaId: got[0]!.id, direction: JSON.stringify(full), promptVersion: "0.2.15" });
    expect(again).toMatchObject({ version: 2, warnings: [] });
  });

  it("takes JSON text through the MCP handler (tools/call)", async () => {
    const env = { PUBLIC_BASE_URL: "https://x.example" } as Env;
    const call = async (args: unknown) =>
      (
        (await (
          await handleMcp(
            new Request("https://x/mcp", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "prompt_get", arguments: args } }) }),
            env,
            {},
          )
        ).json()) as any
      ).result;
    const asObject = await call({ name: "pack", arguments: { batchId: "b1" } });
    const asJson = await call({ name: "pack", arguments: '{"batchId":"b1"}' });
    expect(asJson.isError).toBeUndefined();
    expect(asJson.content[0].text).toBe(asObject.content[0].text);
    const bad = await call({ name: "pack", arguments: "{batchId" });
    expect(bad.isError).toBe(true);
    expect(bad.content[0].text).toBe("Bad input: arguments must be an object; the text given is not valid JSON.");
  });
});
