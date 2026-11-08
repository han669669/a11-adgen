/** A small zip writer for tests (CRC is not checked by the reader). method 0 = stored, 8 = deflate. */
export async function zip(entries: { name: string; data: Uint8Array | string; method?: 0 | 8; flags?: number; usize?: number }[]): Promise<Blob> {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let at = 0;
  for (const e of entries) {
    const raw = typeof e.data === "string" ? new TextEncoder().encode(e.data) : e.data;
    const method = e.method ?? 8;
    const packed = method === 8 ? new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer()) : raw;
    const name = new TextEncoder().encode(e.name);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(8, method, true);
    local.setUint32(18, packed.length, true);
    local.setUint32(22, e.usize ?? raw.length, true);
    local.setUint16(26, name.length, true);
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true);
    cen.setUint16(8, e.flags ?? 0, true);
    cen.setUint16(10, method, true);
    cen.setUint32(20, packed.length, true);
    cen.setUint32(24, e.usize ?? raw.length, true);
    cen.setUint16(28, name.length, true);
    cen.setUint32(42, at, true);
    parts.push(new Uint8Array(local.buffer), name, packed);
    central.push(new Uint8Array(cen.buffer), name);
    at += 30 + name.length + packed.length;
  }
  const cd = central.reduce((n, c) => n + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, cd, true);
  end.setUint32(16, at, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)]);
}

export const fromB64 = (b64: string) => new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))]);
