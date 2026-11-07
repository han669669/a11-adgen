import { describe, expect, it } from "vitest";
import { XlsxError, isXlsx, listZip, xlsxToCsv } from "../worker/xlsx";
import { OPENPYXL_XLSX, XLSXWRITER_XLSX } from "./helpers/xlsxFixtures";
import { fromB64, zip } from "./helpers/zip";

const WORKBOOK = '<workbook xmlns:r="r"><sheets><sheet name="Ads" sheetId="1" r:id="rId1"/></sheets></workbook>';
const RELS = '<Relationships><Relationship Id="rId1" Type="x" Target="worksheets/sheet1.xml"/></Relationships>';
const sheet = (rows: string) => `<worksheet><sheetData>${rows}</sheetData></worksheet>`;
const book = (rows: string, extra: { name: string; data: string }[] = []) => zip([{ name: "xl/workbook.xml", data: WORKBOOK }, { name: "xl/_rels/workbook.xml.rels", data: RELS }, { name: "xl/worksheets/sheet1.xml", data: sheet(rows) }, ...extra]);

describe("xlsx reader", () => {
  it("reads real Excel files from two different writers: quotes, line breaks, dates, a blank cell, a formula value, entities, first sheet only", async () => {
    const first = 'Ad name,Impressions,Clicks,Spend,Day,Note\na11_W45_wongi_b01_tof_c01_v1,2000,60,12.5,2026-11-02,"Café, ""quoted"""\na11_W45_wongi_b01_mof_c01_v1,1500,';
    for (const [fixture, third] of [[OPENPYXL_XLSX, ",3.75,2026-11-03 14:30:00,\"line1\nline2\"\nTRUE,x < y & z\n"], [XLSXWRITER_XLSX, "500,3.75,2026-11-03 14:30:00,\"line1\nline2\"\nTRUE\n"]] as const) {
      const f = fromB64(fixture);
      expect(await isXlsx(f)).toBe(true);
      const r = await xlsxToCsv(f);
      expect(r.sheet).toBe("Ads");
      expect(r.csv).toBe(first + third);
      expect(r.csv).not.toContain("ignored"); // the second sheet is not read
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
    const f = await book('<row><c t="inlineStr"><is><t>&lt;img src=x onerror=alert(1)&gt; &#x41;&#66; &bogus; &#99999999999;</t></is></c></row>', [{ name: "xl/sharedStrings.xml", data: '<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><sst><si><t>&e;</t></si></sst>' }]);
    expect((await xlsxToCsv(f)).csv).toBe("<img src=x onerror=alert(1)> AB &bogus; \n");
  });

  it("takes linear time on hostile XML (unclosed tags, nested tags, long runs): a client cannot hang a request", async () => {
    const hostile = [
      "<sheetData><row>" + "<c ".repeat(1_500_000) + "</row></sheetData>",
      "<sheetData>" + "<row ".repeat(1_000_000),
      "<sheetData>" + "<row><c>".repeat(500_000),
      '<sheetData><row><c t="inlineStr"><is>' + "<rPh>".repeat(1_000_000) + "</is></c></row></sheetData>",
      "<sheetData>" + '<row><c r="XFD1"><v>1</v></c></row>'.repeat(100_000) + "</sheetData>",
    ];
    for (const xml of hostile) {
      const z = await zip([{ name: "xl/workbook.xml", data: WORKBOOK }, { name: "xl/_rels/workbook.xml.rels", data: RELS }, { name: "xl/worksheets/sheet1.xml", data: xml }]);
      const t = Date.now();
      await xlsxToCsv(z).catch((e) => expect(e).toBeInstanceOf(XlsxError));
      expect(Date.now() - t).toBeLessThan(3000);
    }
    // A hostile styles part and shared strings part too.
    const z = await zip([
      { name: "xl/workbook.xml", data: WORKBOOK },
      { name: "xl/_rels/workbook.xml.rels", data: RELS },
      { name: "xl/worksheets/sheet1.xml", data: sheet('<row><c t="s"><v>0</v></c></row>') },
      { name: "xl/styles.xml", data: "<numFmt ".repeat(120_000) + "<cellXfs " + "<xf ".repeat(100_000) },
      { name: "xl/sharedStrings.xml", data: "<si>".repeat(400_000) },
    ]);
    const t = Date.now();
    await xlsxToCsv(z).catch((e) => expect(e).toBeInstanceOf(XlsxError));
    expect(Date.now() - t).toBeLessThan(3000);
  });

  it("lists entries of a stored zip", async () => {
    const z = await listZip(await zip([{ name: "a.txt", data: "x", method: 0 }]));
    expect([...z!.keys()]).toEqual(["a.txt"]);
  });
});
