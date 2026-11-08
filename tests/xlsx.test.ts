import { describe, expect, it } from "vitest";
import { XlsxError, isXlsx, listZip, newWork, xlsxToCsv } from "../worker/xlsx";
import { OPENPYXL_XLSX, XLSXWRITER_XLSX } from "./helpers/xlsxFixtures";
import { fromB64, zip } from "./helpers/zip";

const WORKBOOK = '<workbook xmlns:r="r"><sheets><sheet name="Ads" sheetId="1" r:id="rId1"/></sheets></workbook>';
const RELS = '<Relationships><Relationship Id="rId1" Type="x" Target="worksheets/sheet1.xml"/></Relationships>';
const sheet = (rows: string) => `<worksheet><sheetData>${rows}</sheetData></worksheet>`;
const book = (rows: string, extra: { name: string; data: string }[] = []) => zip([{ name: "xl/workbook.xml", data: WORKBOOK }, { name: "xl/_rels/workbook.xml.rels", data: RELS }, { name: "xl/worksheets/sheet1.xml", data: sheet(rows) }, ...extra]);

describe("xlsx reader", () => {
  it("reads real Excel files from two different writers: quotes, line breaks, dates, a blank cell, a formula value, entities, and every sheet with a heading line", async () => {
    const first = '# Sheet: Ads\nAd name,Impressions,Clicks,Spend,Day,Note\na11_W45_wongi_b01_tof_c01_v1,2000,60,12.5,2026-11-02,"Café, ""quoted"""\na11_W45_wongi_b01_mof_c01_v1,1500,';
    for (const [fixture, third] of [[OPENPYXL_XLSX, ",3.75,2026-11-03 14:30:00,\"line1\nline2\"\nTRUE,x < y & z\n\n# Sheet: Other\nignored\n"], [XLSXWRITER_XLSX, "500,3.75,2026-11-03 14:30:00,\"line1\nline2\"\nTRUE\n\n# Sheet: Other\nignored\n"]] as const) {
      const f = fromB64(fixture);
      expect(await isXlsx(f)).toBe(true);
      const r = await xlsxToCsv(f);
      expect(r.sheets).toEqual(["Ads", "Other"]);
      expect(r.csv).toBe(first + third);
    }
  });

  it("reads inline strings, booleans, errors, a date style, a gap in columns and an empty row", async () => {
    const styles = '<styleSheet><numFmts><numFmt numFmtId="164" formatCode="dd\\/mm\\/yyyy"/></numFmts><cellXfs><xf numFmtId="0"/><xf numFmtId="164"/><xf numFmtId="14"/></cellXfs></styleSheet>';
    const f = await book(
      '<row r="1"><c r="A1" t="inlineStr"><is><t>Name</t></is></c><c r="D1" t="b"><v>0</v></c><c r="E1" t="e"><v>#DIV/0!</v></c></row><row r="2"/><row r="3"><c r="A3" s="1"><v>46023</v></c><c r="B3" s="2"><v>46023.5</v></c><c r="C3" s="0"><v>46023</v></c><c r="D3"/></row>',
      [{ name: "xl/styles.xml", data: styles }],
    );
    expect((await xlsxToCsv(f)).csv).toBe("Name,,,FALSE,#DIV/0!\n2026-01-01,2026-01-01 12:00:00,46023\n");
  });

  it("falls back to the first worksheet file when the relationship is missing", async () => {
    const f = await zip([{ name: "xl/workbook.xml", data: "<workbook/>" }, { name: "xl/worksheets/sheet1.xml", data: sheet('<row><c t="inlineStr"><is><t>a</t></is></c><c t="inlineStr"><is><t>b</t></is></c></row>') }]);
    expect((await xlsxToCsv(f)).csv).toBe("a,b\n");
  });

  it("says empty for a sheet with no values", async () => {
    await expect(xlsxToCsv(await book('<row r="1"><c r="A1"/></row>'))).rejects.toBeInstanceOf(XlsxError);
  });

  const row = (v: string) => `<row r="1"><c r="A1" t="inlineStr"><is><t>${v}</t></is></c></row>`;
  const many = (sheets: { name: string; xml: string; state?: string }[]) =>
    zip([
      { name: "xl/workbook.xml", data: `<workbook xmlns:r="r"><sheets>${sheets.map((s, i) => `<sheet name="${s.name}" sheetId="${i + 1}"${s.state ? ` state="${s.state}"` : ""} r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>` },
      { name: "xl/_rels/workbook.xml.rels", data: `<Relationships>${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="x" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}</Relationships>` },
      ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: s.xml })),
    ]);

  it("reads every visible sheet in order, skips hidden and empty sheets, and gives no heading when only one sheet has values", async () => {
    const f = await many([{ name: "Summary", xml: sheet(row("one")) }, { name: "Secret", state: "hidden", xml: sheet(row("hidden")) }, { name: "Blank", xml: sheet('<row r="1"/>') }, { name: "Detail", xml: sheet(row("two")) }]);
    const r = await xlsxToCsv(f);
    expect(r.csv).toBe("# Sheet: Summary\none\n\n# Sheet: Detail\ntwo\n");
    expect(r.sheets).toEqual(["Summary", "Detail"]);
    const one = await many([{ name: "Blank", xml: sheet('<row r="1"/>') }, { name: "Only", xml: sheet(row("x")) }]);
    expect((await xlsxToCsv(one)).csv).toBe("x\n");
  });

  it("makes a hostile sheet name a safe one-line heading", async () => {
    const f = await many([{ name: "a&#10;# Sheet: fake&#13;b", xml: sheet(row("one")) }, { name: "&lt;img src=x onerror=alert(1)&gt;" + "z".repeat(300), xml: sheet(row("two")) }]);
    const lines = (await xlsxToCsv(f)).csv.split("\n").filter((l) => l.startsWith("#"));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe("# Sheet: a # Sheet: fake b"); // the line breaks became spaces: no fake second heading
    expect(lines[1]!.length).toBeLessThan(120);
  });

  it("reads at most 30 sheets", async () => {
    const f = await many(Array.from({ length: 45 }, (_, i) => ({ name: `S${i + 1}`, xml: sheet(row(`v${i + 1}`)) })));
    const r = await xlsxToCsv(f);
    expect(r.sheets).toHaveLength(30);
    expect(r.sheets[29]).toBe("S30");
  });

  it("stops a zip bomb: a part that unpacks past the cap is refused, fast and without holding it", async () => {
    const bomb = await zip([{ name: "xl/workbook.xml", data: WORKBOOK }, { name: "xl/_rels/workbook.xml.rels", data: RELS }, { name: "xl/worksheets/sheet1.xml", data: new Uint8Array(60_000_000).fill(32) }]);
    expect(bomb.size).toBeLessThan(200_000); // small on disk, huge unpacked
    const t = Date.now();
    await expect(xlsxToCsv(bomb)).rejects.toThrow(XlsxError);
    expect(Date.now() - t).toBeLessThan(5000);
  });

  it("refuses a stored (uncompressed) part over the cap without reading it", async () => {
    const big = await zip([{ name: "xl/workbook.xml", data: WORKBOOK }, { name: "xl/_rels/workbook.xml.rels", data: RELS }, { name: "xl/worksheets/sheet1.xml", data: new Uint8Array(11_000_000).fill(32), method: 0 }]);
    await expect(xlsxToCsv(big)).rejects.toThrow(XlsxError);
  });

  it("is not fooled by things that are not a plain Excel file", async () => {
    expect(await isXlsx(new Blob(["PK not really"]))).toBe(false);
    expect(await isXlsx(new Blob([new Uint8Array(100)]))).toBe(false);
    expect(await isXlsx(await zip([{ name: "word/document.xml", data: "<x/>" }]))).toBe(false); // a zip, but not Excel
    expect(await isXlsx(await zip([{ name: "xl/workbook.xml", data: WORKBOOK, flags: 1 }]))).toBe(false); // encrypted
    const whole = fromB64(OPENPYXL_XLSX);
    expect(await isXlsx(whole.slice(0, whole.size - 10))).toBe(false); // cut short: no directory
    // A directory that points outside the file.
    const bytes = new Uint8Array(await whole.arrayBuffer());
    new DataView(bytes.buffer).setUint32(bytes.length - 6, 0x7fffffff, true);
    expect(await isXlsx(new Blob([bytes]))).toBe(false);
  });

  it("a corrupt packed part is a plain error, not a crash", async () => {
    const good = await book('<row><c t="inlineStr"><is><t>a</t></is></c></row>');
    const bytes = new Uint8Array(await good.arrayBuffer());
    const at = 30 + "xl/workbook.xml".length; // the first part's packed bytes
    for (let i = 0; i < 6; i++) bytes[at + i] = 0xff;
    await expect(xlsxToCsv(new Blob([bytes]))).rejects.toThrow(XlsxError);
  });

  it("never follows an entity or an include: text stays text", async () => {
    const f = await book(
      '<row><c t="inlineStr"><is><t>&lt;img src=x onerror=alert(1)&gt; &#x41;&#66; &bogus; &#99999999999;</t></is></c><c t="s"><v>0</v></c><c t="s"><v>1</v></c></row>',
      [{ name: "xl/sharedStrings.xml", data: '<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><sst><si><t>&e;</t></si><si><t>&xi;<xi:include href="file:///etc/passwd"/></t></si></sst>' }],
    );
    // The entity stays the text "&e;", and the include stays text too (quoted): nothing from /etc/passwd is read.
    const csv = (await xlsxToCsv(f)).csv;
    expect(csv).toBe('<img src=x onerror=alert(1)> AB &bogus; ,&e;,"&xi;<xi:include href=""file:///etc/passwd""/>"\n');
    expect(csv).not.toContain("root:");
  });

  const zipOf = (xml: string, extra: { name: string; data: string }[] = []) => zip([{ name: "xl/workbook.xml", data: WORKBOOK }, { name: "xl/_rels/workbook.xml.rels", data: RELS }, { name: "xl/worksheets/sheet1.xml", data: xml }, ...extra]);

  it("takes linear time on hostile XML (unclosed tags, nested tags, long runs) and refuses it: a client cannot hang a request", async () => {
    const malformed = [
      "<sheetData><row>" + "<c ".repeat(1_500_000) + "</row></sheetData>",
      "<sheetData>" + "<row ".repeat(1_000_000),
      "<sheetData>" + "<row><c>".repeat(500_000),
      '<sheetData><row><c t="inlineStr"><is>' + "<rPh>".repeat(1_000_000) + "</is></c></row></sheetData>",
      "<sheetData>" + '<row><c r="XFD1"><v>1</v></c></row>'.repeat(100_000) + "</sheetData>", // every cell is far to the right: nothing to read
    ];
    for (const xml of malformed) {
      const z = await zipOf(xml);
      const t = Date.now();
      await expect(xlsxToCsv(z)).rejects.toBeInstanceOf(XlsxError);
      expect(Date.now() - t).toBeLessThan(3000);
    }
    // A valid sheet with many rows is read, in good time.
    const big = await zipOf("<sheetData>" + '<row><c r="A1" t="inlineStr"><is><t>x</t></is></c></row>'.repeat(100_000) + "</sheetData>");
    const t = Date.now();
    expect((await xlsxToCsv(big)).csv.split("\n")).toHaveLength(100_001);
    expect(Date.now() - t).toBeLessThan(3000);
    // A hostile styles part and shared strings part too.
    for (const extra of [[{ name: "xl/styles.xml", data: "<numFmt ".repeat(120_000) + "<cellXfs " + "<xf ".repeat(100_000) }], [{ name: "xl/sharedStrings.xml", data: "<si>".repeat(400_000) }]]) {
      const z = await zipOf('<sheetData><row><c t="s"><v>0</v></c></row></sheetData>', extra);
      const t2 = Date.now();
      await expect(xlsxToCsv(z)).rejects.toBeInstanceOf(XlsxError);
      expect(Date.now() - t2).toBeLessThan(3000);
    }
  });

  it("refuses a cut-off sheet instead of giving a part of a report", async () => {
    const f = await zipOf('<sheetData><row><c t="inlineStr"><is><t>good</t></is></c></row><row><c t="inlineStr"><is><t>cut off here');
    await expect(xlsxToCsv(f)).rejects.toBeInstanceOf(XlsxError);
  });

  it("leaves out a cell far to the right and never moves it onto another column", async () => {
    const f = await zipOf('<sheetData><row><c r="A1" t="inlineStr"><is><t>a</t></is></c><c r="CCC1" t="inlineStr"><is><t>far</t></is></c><c r="B1" t="inlineStr"><is><t>b</t></is></c></row></sheetData>');
    expect((await xlsxToCsv(f)).csv).toBe("a,b\n");
  });

  it("reads dates in a 1904 workbook from the 1904 start", async () => {
    const styles = '<styleSheet><cellXfs><xf numFmtId="14"/></cellXfs></styleSheet>';
    const wb = '<workbook xmlns:r="r"><workbookPr date1904="1"/><sheets><sheet name="Ads" sheetId="1" r:id="rId1"/></sheets></workbook>';
    const f = await zip([{ name: "xl/workbook.xml", data: wb }, { name: "xl/_rels/workbook.xml.rels", data: RELS }, { name: "xl/styles.xml", data: styles }, { name: "xl/worksheets/sheet1.xml", data: sheet('<row><c r="A1" s="0"><v>0</v></c><c r="B1" s="0"><v>1461</v></c></row>') }]);
    expect((await xlsxToCsv(f)).csv).toBe("1904-01-01,1908-01-01\n");
  });

  it("ignores XML comments and reads CDATA as plain text", async () => {
    const f = await zipOf('<sheetData><row><c t="inlineStr"><is><t>keep</t></is></c><!-- <c t="inlineStr"><is><t>fake</t></is></c> --><c t="inlineStr"><is><t><![CDATA[a<c>&b]]></t></is></c></row></sheetData>');
    expect((await xlsxToCsv(f)).csv).toBe("keep,a<c>&b\n");
    await expect(xlsxToCsv(await zipOf("<sheetData><!-- never ended"))).rejects.toBeInstanceOf(XlsxError);
  });

  it("refuses a part whose real unpacked size is not the size the zip declares", async () => {
    const f = await zip([{ name: "xl/workbook.xml", data: WORKBOOK }, { name: "xl/_rels/workbook.xml.rels", data: RELS }, { name: "xl/worksheets/sheet1.xml", data: sheet('<row><c t="inlineStr"><is><t>a</t></is></c></row>'), usize: 5 }]);
    await expect(xlsxToCsv(f)).rejects.toBeInstanceOf(XlsxError);
  });

  it("quotes a cell that looks like one of the reader's own heading lines, so data cannot fake a sheet", async () => {
    const f = await many([{ name: "Real", xml: sheet(row("# Sheet: fake")) }, { name: "Two", xml: sheet(row("# Not read: 99 more sheets")) }]);
    const { csv } = await xlsxToCsv(f);
    expect(csv.split("\n").filter((l) => l.startsWith("# Sheet:"))).toEqual(["# Sheet: Real", "# Sheet: Two"]);
    expect(csv).toContain('"# Sheet: fake"');
    expect(csv.split("\n").some((l) => l.startsWith("# Not read:"))).toBe(false);
  });

  it("the unpacked byte budget counts every part of the file, shared strings too", async () => {
    const pad = (n: number) => " ".repeat(n);
    const f = await zipOf('<sheetData><row><c t="s"><v>0</v></c></row></sheetData>' + pad(4_000_000), [{ name: "xl/sharedStrings.xml", data: "<sst><si><t>a</t></si></sst>" + pad(7_000_000) }]); // 11 MB in all
    await expect(xlsxToCsv(f)).rejects.toThrow(XlsxError);
  });

  it("one send has one budget of Excel work: the file that would pass it is refused, and it says so", async () => {
    const heavy = () => zipOf(sheet(row("v")) + " ".repeat(8_000_000)); // 8 MB unpacked, tiny on disk
    const work = newWork();
    expect((await xlsxToCsv(await heavy(), work)).csv).toBe("v\n");
    expect((await xlsxToCsv(await heavy(), work)).csv).toBe("v\n");
    await expect(xlsxToCsv(await heavy(), work)).rejects.toThrow(XlsxError); // 8 + 8 + 8 is over the 20 MB of one send
  });

  it("says in the text what it left out: sheets that did not fit, and rows past the text cap", async () => {
    const filler = (n: number) => sheet(row("x") + " ".repeat(n));
    const r = await xlsxToCsv(await many([{ name: "A", xml: filler(6_000_000) }, { name: "B", xml: filler(6_000_000) }]));
    expect(r.sheets).toEqual(["A"]);
    expect(r.csv).toBe("x\n# Not read: 1 more sheet (too much data)\n");
    const line = "<row><c t=\"inlineStr\"><is><t>" + "y".repeat(100) + "</t></is></c></row>";
    const cut = await xlsxToCsv(await zipOf("<sheetData>" + line.repeat(30_000) + "</sheetData>")); // 3 MB of text
    expect(cut.csv.endsWith("# Cut: more rows were left out (too long)\n")).toBe(true);
    expect(cut.csv.length).toBeLessThan(2_100_000);
  });

  it("lists entries of a stored zip", async () => {
    const z = await listZip(await zip([{ name: "a.txt", data: "x", method: 0 }]));
    expect([...z!.keys()]).toEqual(["a.txt"]);
  });
});
