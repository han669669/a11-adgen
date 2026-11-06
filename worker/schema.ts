/**
 * A small JSON Schema subset for tool inputs: object, string, integer, array of strings, enum, default.
 * The same object goes to tools/list (so Claude sees it) and checks the arguments.
 */
export type Prop =
  | { type: "string"; description?: string; minLength?: number; maxLength?: number; pattern?: string; format?: "uri"; enum?: string[]; default?: string }
  | { type: "integer"; description?: string; minimum?: number; maximum?: number; default?: number }
  | { type: "array"; description?: string; items: { type: "string"; format?: "uri" }; minItems?: number; maxItems?: number };

export interface ObjectSchema {
  type: "object";
  properties: Record<string, Prop>;
  required?: string[];
  additionalProperties: false;
}

export class InputError extends Error {}

function isUri(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

function checkString(name: string, p: Extract<Prop, { type: "string" }>, v: unknown): string {
  if (typeof v !== "string") throw new InputError(`${name} must be a string.`);
  if (p.minLength !== undefined && v.length < p.minLength) throw new InputError(`${name} is too short (min ${p.minLength}).`);
  if (p.maxLength !== undefined && v.length > p.maxLength) throw new InputError(`${name} is too long (max ${p.maxLength}).`);
  if (p.pattern && !new RegExp(p.pattern).test(v)) throw new InputError(`${name} has the wrong format.`);
  if (p.format === "uri" && !isUri(v)) throw new InputError(`${name} must be an http(s) URL.`);
  if (p.enum && !p.enum.includes(v)) throw new InputError(`${name} must be one of: ${p.enum.join(", ")}.`);
  return v;
}

/** Check args against the schema. Returns a copy with defaults filled in. */
export function validate(schema: ObjectSchema, args: unknown): Record<string, unknown> {
  const input = (args ?? {}) as Record<string, unknown>;
  if (typeof input !== "object" || Array.isArray(input)) throw new InputError("Arguments must be an object.");
  for (const key of Object.keys(input)) {
    if (!(key in schema.properties)) throw new InputError(`Unknown argument: ${key}.`);
  }
  const out: Record<string, unknown> = {};
  for (const [name, p] of Object.entries(schema.properties)) {
    let v = input[name];
    if (v === undefined && "default" in p) v = p.default;
    if (v === undefined) {
      if (schema.required?.includes(name)) throw new InputError(`${name} is required.`);
      continue;
    }
    if (p.type === "string") out[name] = checkString(name, p, v);
    else if (p.type === "integer") {
      if (typeof v !== "number" || !Number.isInteger(v)) throw new InputError(`${name} must be an integer.`);
      if (p.minimum !== undefined && v < p.minimum) throw new InputError(`${name} must be at least ${p.minimum}.`);
      if (p.maximum !== undefined && v > p.maximum) throw new InputError(`${name} must be at most ${p.maximum}.`);
      out[name] = v;
    } else {
      if (!Array.isArray(v)) throw new InputError(`${name} must be an array.`);
      if (p.minItems !== undefined && v.length < p.minItems) throw new InputError(`${name} needs at least ${p.minItems} items.`);
      if (p.maxItems !== undefined && v.length > p.maxItems) throw new InputError(`${name} allows at most ${p.maxItems} items.`);
      out[name] = v.map((item, i) => checkString(`${name}[${i}]`, { type: "string", format: p.items.format }, item));
    }
  }
  return out;
}
