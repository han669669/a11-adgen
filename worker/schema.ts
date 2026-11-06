/**
 * A small JSON Schema subset for tool inputs: object, string, integer, boolean, array, enum, default.
 * The same object goes to tools/list (so Claude sees it) and checks the arguments.
 */
export type StringProp = {
  type: "string";
  description?: string;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: "uri";
  enum?: string[];
  default?: string;
};
export type Prop =
  | StringProp
  | { type: "integer"; description?: string; minimum?: number; maximum?: number; default?: number }
  | { type: "boolean"; description?: string; default?: boolean }
  | { type: "array"; description?: string; items: StringProp | ObjectSchema; minItems?: number; maxItems?: number }
  | ObjectSchema;

export interface ObjectSchema {
  type: "object";
  description?: string;
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

function checkString(name: string, p: StringProp, v: unknown): string {
  if (typeof v !== "string") throw new InputError(`${name} must be a string.`);
  if (p.minLength !== undefined && v.length < p.minLength) throw new InputError(`${name} is too short (min ${p.minLength}).`);
  if (p.maxLength !== undefined && v.length > p.maxLength) throw new InputError(`${name} is too long (max ${p.maxLength}).`);
  if (p.pattern && !new RegExp(p.pattern).test(v)) throw new InputError(`${name} has the wrong format.`);
  if (p.format === "uri" && !isUri(v)) throw new InputError(`${name} must be an http(s) URL.`);
  if (p.enum && !p.enum.includes(v)) throw new InputError(`${name} must be one of: ${p.enum.join(", ")}.`);
  return v;
}

function checkProp(name: string, p: Prop, v: unknown): unknown {
  switch (p.type) {
    case "string":
      return checkString(name, p, v);
    case "integer":
      if (typeof v !== "number" || !Number.isInteger(v)) throw new InputError(`${name} must be an integer.`);
      if (p.minimum !== undefined && v < p.minimum) throw new InputError(`${name} must be at least ${p.minimum}.`);
      if (p.maximum !== undefined && v > p.maximum) throw new InputError(`${name} must be at most ${p.maximum}.`);
      return v;
    case "boolean":
      if (typeof v !== "boolean") throw new InputError(`${name} must be true or false.`);
      return v;
    case "array":
      if (!Array.isArray(v)) throw new InputError(`${name} must be an array.`);
      if (p.minItems !== undefined && v.length < p.minItems) throw new InputError(`${name} needs at least ${p.minItems} items.`);
      if (p.maxItems !== undefined && v.length > p.maxItems) throw new InputError(`${name} allows at most ${p.maxItems} items.`);
      return v.map((item, i) => checkProp(`${name}[${i}]`, p.items, item));
    case "object":
      return checkObject(name, p, v);
  }
}

function checkObject(name: string, schema: ObjectSchema, args: unknown): Record<string, unknown> {
  if (args === null) throw new InputError(`${name || "Arguments"} must be an object.`);
  const input = (args ?? {}) as Record<string, unknown>;
  if (typeof input !== "object" || Array.isArray(input)) throw new InputError(`${name || "Arguments"} must be an object.`);
  const prefix = name ? `${name}.` : "";
  for (const key of Object.keys(input)) {
    if (!Object.hasOwn(schema.properties, key)) throw new InputError(`Unknown argument: ${prefix}${key}.`);
  }
  const out: Record<string, unknown> = {};
  for (const [key, p] of Object.entries(schema.properties)) {
    let v = input[key];
    if (v === undefined && "default" in p) v = p.default;
    if (v === undefined) {
      if (schema.required?.includes(key)) throw new InputError(`${prefix}${key} is required.`);
      continue;
    }
    out[key] = checkProp(`${prefix}${key}`, p, v);
  }
  return out;
}

/** Check args against the schema. Returns a copy with defaults filled in. */
export function validate(schema: ObjectSchema, args: unknown): Record<string, unknown> {
  if (args !== undefined && (typeof args !== "object" || args === null || Array.isArray(args))) {
    throw new InputError("Arguments must be an object.");
  }
  return checkObject("", schema, args);
}
