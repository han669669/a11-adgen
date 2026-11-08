/**
 * Read an .xlsx file (a zip of XML files) and give its sheets as CSV text.
 * No dependency. A client sends the file, so every read is bounded: a zip bomb is stopped by a cap on the unpacked size of each part.
 * A Google Sheet downloaded as Excel is an .xlsx file too.
 */

/** The most unpacked bytes the Worker reads from the data parts (all the sheet files together, and the shared strings). A results export is far smaller. */
const PART_MAX = 10_000_000;
/** The same, for the small parts that describe the file (the workbook, its links and the styles). */
const META_MAX = 1_000_000;
/** The CSV text stops here. The owner's tool reads only the first 100,000 bytes anyway. */
const CSV_MAX = 2_000_000;
const MAX_COLUMNS = 2_000;
/** The most sheets read from one workbook. */
const MAX_SHEETS = 30;
/** Unpacked bytes one send (up to 10 files) may spend on Excel files in all. Work is the CPU cost, and one send must not multiply it by ten. */
const REQUEST_WORK = 20_000_000;

export class XlsxError extends Error {}

interface ZipEntry {
  name: string;
  method: number;
  size: number;
  /** The unpacked size the zip declares (checked after unpacking: a short or long part means a damaged or lying file). */
  usize: number;
  offset: number;
  encrypted: boolean;
}

/** The files listed in a zip's central directory, or null when this is not a (plain, non-zip64) zip. */
export async function listZip(file: Blob): Promise<Map<string, ZipEntry> | null> {
  if (file.size < 22) return null;
  const tail = new Uint8Array(await file.slice(Math.max(0, file.size - 22 - 65_535)).arrayBuffer());
  const tv = new DataView(tail.buffer);
  let end = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tv.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) return null;
  const count = tv.getUint16(end + 10, true);
  const cdSize = tv.getUint32(end + 12, true);
  const cdAt = tv.getUint32(end + 16, true);
  if (count === 0xffff || cdAt === 0xffffffff || cdSize > 5_000_000 || cdAt + cdSize > file.size) return null;
  const cd = new Uint8Array(await file.slice(cdAt, cdAt + cdSize).arrayBuffer());
  const cv = new DataView(cd.buffer);
  const out = new Map<string, ZipEntry>();
  let p = 0;
  for (let n = 0; n < count; n++) {
    if (p + 46 > cd.length || cv.getUint32(p, true) !== 0x02014b50) return null;
    const nameLen = cv.getUint16(p + 28, true);
    const name = new TextDecoder().decode(cd.subarray(p + 46, p + 46 + nameLen));
    out.set(name, { name, method: cv.getUint16(p + 10, true), size: cv.getUint32(p + 20, true), usize: cv.getUint32(p + 24, true), offset: cv.getUint32(p + 42, true), encrypted: (cv.getUint16(p + 8, true) & 1) === 1 });
    p += 46 + nameLen + cv.getUint16(p + 30, true) + cv.getUint16(p + 32, true);
  }
  return out;
}

/** A plain .xlsx: a zip that lists xl/workbook.xml and is not encrypted. */
export async function isXlsx(file: Blob): Promise<boolean> {
  try {
    const z = await listZip(file);
    const w = z?.get("xl/workbook.xml");
    return !!w && !w.encrypted;
  } catch {
    return false;
  }
}

async function readPart(file: Blob, e: ZipEntry, max = PART_MAX): Promise<string> {
  if (e.encrypted) throw new XlsxError("locked");
  const head = new DataView(await file.slice(e.offset, e.offset + 30).arrayBuffer());
  if (head.byteLength < 30 || head.getUint32(0, true) !== 0x04034b50) throw new XlsxError("broken");
  const start = e.offset + 30 + head.getUint16(26, true) + head.getUint16(28, true);
  const packed = file.slice(start, start + e.size);
  if (e.method === 0) {
    if (e.size > max) throw new XlsxError("big");
    if (e.size !== e.usize) throw new XlsxError("broken");
    return plain(new TextDecoder().decode(await packed.arrayBuffer()));
  }
  if (e.method !== 8) throw new XlsxError("broken");
  const reader = packed.stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > max) {
        await reader.cancel().catch(() => undefined);
        throw new XlsxError("big");
      }
      chunks.push(value);
    }
  } catch (err) {
    throw err instanceof XlsxError ? err : new XlsxError("broken");
  }
  if (total !== e.usize) throw new XlsxError("broken");
  const all = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.length;
  }
  return plain(new TextDecoder().decode(all));
}

/** The XML without comments, and with each CDATA block turned into escaped text, so the tag scan below sees only real elements. One pass. */
function plain(xml: string): string {
  if (!xml.includes("<!")) return xml;
  let out = "";
  let at = 0;
  for (;;) {
    const s = xml.indexOf("<!", at);
    if (s < 0) return out + xml.slice(at);
    out += xml.slice(at, s);
    if (xml.startsWith("<!--", s)) {
      const e = xml.indexOf("-->", s + 4);
      if (e < 0) throw new XlsxError("broken");
      at = e + 3;
    } else if (xml.startsWith("<![CDATA[", s)) {
      const e = xml.indexOf("]]>", s + 9);
      if (e < 0) throw new XlsxError("broken");
      out += xml.slice(s + 9, e).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      at = e + 3;
    } else {
      // <!DOCTYPE ...>: kept as it is. Nothing here expands an entity.
      const e = xml.indexOf(">", s);
      if (e < 0) throw new XlsxError("broken");
      out += xml.slice(s, e + 1);
      at = e + 1;
    }
  }
}

const unxml = (s: string) =>
  s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, e: string) => {
    if (e[0] !== "#") return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[e]!;
    try {
      return String.fromCodePoint(e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    } catch {
      return "";
    }
  });

/** The value of an attribute in the text between a tag's name and its end. */
const attr = (attrs: string, name: string) => new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(attrs)?.[1];

/**
 * One pass over the XML: each element <name ...>body</name> (or <name .../>), in order. An element that is never closed is an error: a cut-off file must not give a part of a report.
 * No pattern here scans to the end of the text from every start: that would take quadratic time on a hostile file ("<c <c <c ..."). Every byte is read at most once.
 */
function* elements(xml: string, name: string, withBody = true): Generator<{ attrs: string; body: string }> {
  const open = `<${name}`;
  const close = `</${name}>`;
  let at = 0;
  for (;;) {
    const s = xml.indexOf(open, at);
    if (s < 0) return;
    const next = xml.charCodeAt(s + open.length);
    // After the name must come a space, a new line, ">" or "/" (so <c matches <c r="A1"> but not <cols>).
    if (next !== 62 && next !== 47 && next !== 32 && next !== 9 && next !== 10 && next !== 13) {
      at = s + open.length;
      continue;
    }
    const end = xml.indexOf(">", s + open.length);
    if (end < 0) throw new XlsxError("broken");
    const selfClosing = xml.charCodeAt(end - 1) === 47;
    const attrs = xml.slice(s + open.length, selfClosing ? end - 1 : end);
    if (selfClosing || !withBody) {
      yield { attrs, body: "" };
      at = end + 1;
      continue;
    }
    const stop = xml.indexOf(close, end + 1);
    if (stop < 0) throw new XlsxError("broken");
    yield { attrs, body: xml.slice(end + 1, stop) };
    at = stop + close.length;
  }
}

/** The text without the parts inside <name>...</name> (also one pass). */
function without(xml: string, name: string): string {
  let out = "";
  let at = 0;
  for (;;) {
    const s = xml.indexOf(`<${name}`, at);
    const e = s < 0 ? -1 : xml.indexOf(`</${name}>`, s);
    if (s < 0 || e < 0) return out + xml.slice(at, s < 0 ? undefined : s);
    out += xml.slice(at, s);
    at = e + name.length + 3;
  }
}

/** All text in a string item or an inline string. Phonetic hints are left out. */
const textOf = (xml: string) => [...elements(without(xml, "rPh"), "t")].map((t) => unxml(t.body)).join("");

/** UTF-8 bytes of a string (the CSV cap counts bytes, not characters). */
const bytesOf = (s: string) => new TextEncoder().encode(s).byteLength;

/** A cell that starts like one of this reader's own framing lines is quoted, so client data cannot fake a heading or a notice. */
const FRAMING = /^# (Sheet|Not read|Cut):/;
const csvCell = (v: string) => (FRAMING.test(v) || /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

const BUILTIN_DATES = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

/** Which cell styles show a date (a date is stored as a number of days). */
function dateStyles(styles: string): Set<number> {
  const custom = new Map<number, string>();
  for (const f of elements(styles, "numFmt", false)) {
    const id = attr(f.attrs, "numFmtId");
    if (id) custom.set(Number(id), unxml(attr(f.attrs, "formatCode") ?? ""));
  }
  const out = new Set<number>();
  const xfs = elements(styles, "cellXfs").next().value?.body ?? "";
  let i = 0;
  for (const x of elements(xfs, "xf", false)) {
    const id = Number(attr(x.attrs, "numFmtId") ?? 0);
    const code = custom.get(id);
    if (BUILTIN_DATES.has(id) || (code !== undefined && /[dmyhs]/i.test(code.replace(/"[^"]*"|\\.|\[[^\]]*\]/g, "")))) out.add(i);
    i++;
  }
  return out;
}

const EPOCH_1900 = Date.UTC(1899, 11, 30);
const EPOCH_1904 = Date.UTC(1904, 0, 1);

function serialToText(serial: number, epoch: number): string {
  const d = new Date(Math.round(epoch + serial * 86_400_000));
  if (Number.isNaN(d.getTime())) return String(serial);
  const iso = d.toISOString();
  return Number.isInteger(serial) ? iso.slice(0, 10) : `${iso.slice(0, 10)} ${iso.slice(11, 19)}`;
}

const columnOf = (ref: string) => {
  let n = 0;
  for (const ch of /^[A-Z]+/i.exec(ref)?.[0] ?? "") n = n * 26 + (ch.toUpperCase().charCodeAt(0) - 64);
  return n - 1;
};

/** A sheet name as one safe heading line (no line breaks or control characters, not too long). */
const headingName = (name: string) => unxml(name).replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, 100) || "Sheet";

/** The sheets of a workbook, in order, with the path of each sheet's file. A hidden sheet is left out. */
async function listSheets(zip: Map<string, ZipEntry>, workbook: string, rels: () => Promise<string>): Promise<{ name: string; path: string }[]> {
  const targets = new Map<string, string>();
  const relsXml = await rels();
  for (const rel of elements(relsXml, "Relationship", false)) {
    const id = attr(rel.attrs, "Id");
    const target = attr(rel.attrs, "Target") ?? "";
    if (id) targets.set(id, target.startsWith("/") ? target.slice(1) : `xl/${target}`);
  }
  const out: { name: string; path: string }[] = [];
  for (const s of elements(workbook, "sheet", false)) {
    if (/hidden/i.test(attr(s.attrs, "state") ?? "")) continue;
    const rid = attr(s.attrs, "r:id") ?? attr(s.attrs, "id");
    const path = rid && targets.get(rid);
    if (path && zip.has(path)) out.push({ name: attr(s.attrs, "name") ?? "Sheet", path });
  }
  // No usable link: fall back to the sheet files, in number order.
  if (!out.length) {
    const files = [...zip.keys()].filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort((x, y) => Number(/\d+/.exec(x)![0]) - Number(/\d+/.exec(y)![0]));
    for (const path of files) out.push({ name: `Sheet${/\d+/.exec(path)![0]}`, path });
  }
  return out;
}

/** One sheet's rows as CSV lines (formulas give their last saved value, dates give yyyy-mm-dd). Stops at `room` bytes of text. */
function sheetLines(sheetXml: string, shared: string[], dates: Set<number>, epoch: number, room: number): { lines: string[]; cut: boolean } {
  const lines: string[] = [];
  let cut = false;
  let size = 0;
  for (const row of elements(sheetXml, "row")) {
    const cells: string[] = [];
    let at = 0;
    for (const c of elements(row.body, "c")) {
      const tag = c.attrs;
      const body = c.body;
      const col = Math.max(at, attr(tag, "r") ? columnOf(attr(tag, "r")!) : at);
      if (col >= MAX_COLUMNS) continue; // far to the right: left out, never moved onto another column
      const v = elements(body, "v").next().value?.body;
      const t = attr(tag, "t");
      let text = "";
      if (t === "inlineStr") text = textOf(body);
      else if (v !== undefined) {
        if (t === "s") text = shared[Number(v)] ?? "";
        else if (t === "b") text = v === "1" ? "TRUE" : "FALSE";
        else if (t === "str" || t === "e" || t === "d") text = unxml(v);
        else if (dates.has(Number(attr(tag, "s") ?? -1)) && Number.isFinite(Number(v))) text = serialToText(Number(v), epoch);
        else text = v;
      }
      while (cells.length < col) cells.push("");
      cells[col] = csvCell(text);
      at = col + 1;
    }
    while (cells.length && cells[cells.length - 1] === "") cells.pop();
    if (!cells.length) continue;
    const line = cells.join(",");
    size += bytesOf(line) + 1;
    if (size > room) {
      cut = true;
      break;
    }
    lines.push(line);
  }
  return { lines, cut };
}

/** The unpacked bytes one request may spend on Excel files in all (every file also has its own cap). Pass one object to each file of a send. */
export interface Work {
  left: number;
}
export const newWork = (): Work => ({ left: REQUEST_WORK });

/**
 * Every visible sheet of an .xlsx file as CSV text, in workbook order.
 * When more than one sheet has values, each one starts with a line "# Sheet: <name>". A workbook with one sheet gives plain CSV.
 * Anything left out is said in the text: a line "# Not read: ..." for sheets, a line "# Cut: ..." for rows.
 * Bounds: MAX_SHEETS sheets; PART_MAX unpacked bytes for the whole file (every part counts, shared strings too) and the same bytes taken from `work`; CSV_MAX bytes of text.
 */
export async function xlsxToCsv(file: Blob, work: Work = { left: PART_MAX }): Promise<{ csv: string; sheets: string[] }> {
  const zip = await listZip(file);
  if (!zip?.get("xl/workbook.xml")) throw new XlsxError("broken");
  let budget = Math.min(PART_MAX, work.left);
  const part = async (name: string, cap = PART_MAX) => {
    const e = zip.get(name);
    if (!e) return undefined;
    const text = await readPart(file, e, Math.min(cap, budget));
    budget -= e.usize; // readPart has checked that this is the real unpacked size
    work.left -= e.usize;
    return text;
  };
  const workbook = (await part("xl/workbook.xml", META_MAX))!;
  const all = await listSheets(zip, workbook, async () => (await part("xl/_rels/workbook.xml.rels", META_MAX)) ?? "");
  if (!all.length) throw new XlsxError("empty");
  const sheets = all.slice(0, MAX_SHEETS);
  let skipped = all.length - sheets.length;
  const shared: string[] = [];
  for (const si of elements((await part("xl/sharedStrings.xml")) ?? "", "si")) shared.push(textOf(si.body));
  const dates = dateStyles((await part("xl/styles.xml", META_MAX)) ?? "");
  const epoch = /^(1|true)$/i.test(attr(elements(workbook, "workbookPr", false).next().value?.attrs ?? "", "date1904") ?? "") ? EPOCH_1904 : EPOCH_1900;
  const found: { name: string; lines: string[]; cut: boolean }[] = [];
  let room = CSV_MAX;
  for (const [i, s] of sheets.entries()) {
    if (budget <= 0 || room <= 0) {
      skipped += sheets.length - i;
      break;
    }
    let xml: string;
    try {
      xml = (await part(s.path))!;
    } catch (err) {
      // A later sheet that does not fit is left out and said so. If nothing was read yet the file is refused.
      if (found.length && err instanceof XlsxError && err.message === "big") {
        skipped += sheets.length - i;
        break;
      }
      throw err;
    }
    const { lines, cut } = sheetLines(xml, shared, dates, epoch, room);
    if (!lines.length) continue;
    room -= lines.reduce((n, l) => n + bytesOf(l) + 1, 0);
    found.push({ name: headingName(s.name), lines, cut });
  }
  if (!found.length) throw new XlsxError("empty");
  const body = (f: (typeof found)[number]) => f.lines.join("\n") + "\n" + (f.cut ? "# Cut: more rows were left out (too long)\n" : "");
  let csv = found.length === 1 ? body(found[0]!) : found.map((f) => `# Sheet: ${f.name}\n${body(f)}`).join("\n");
  if (skipped) csv += `# Not read: ${skipped} more sheet${skipped === 1 ? "" : "s"} (too much data)\n`;
  return { csv, sheets: found.map((f) => f.name) };
}
