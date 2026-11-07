/**
 * A black-and-white mask PNG for the fal edit endpoint: white = the area to edit, black = keep.
 * Grey 8-bit, no library: rows are filled natively and compressed with CompressionStream("deflate")
 * (zlib format, as PNG needs), so the Worker stays light on CPU.
 */

/** A box in whole percents of the picture: x and y from the top-left corner. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export function checkBoxes(boxes: Box[]): void {
  for (const b of boxes) {
    if (b.x + b.w > 100 || b.y + b.h > 100) throw new Error(`A box must stay inside the picture (x + w and y + h at most 100): ${JSON.stringify(b)}.`);
  }
}

/** A box in pixels: x0 and y0 inside, x1 and y1 outside. The mask and the paste-back use the same pixels. */
export function boxPixels(width: number, height: number, b: Box) {
  return {
    x0: Math.floor((b.x * width) / 100),
    x1: Math.min(width, Math.ceil(((b.x + b.w) * width) / 100)),
    y0: Math.floor((b.y * height) / 100),
    y1: Math.min(height, Math.ceil(((b.y + b.h) * height) / 100)),
  };
}

export async function maskPng(width: number, height: number, boxes: Box[]): Promise<Uint8Array> {
  checkBoxes(boxes);
  const rowLen = width + 1; // filter byte 0, then one grey byte per pixel
  const raw = new Uint8Array(rowLen * height);
  for (const b of boxes) {
    const { x0, x1, y0, y1 } = boxPixels(width, height, b);
    for (let y = y0; y < y1; y++) raw.fill(255, y * rowLen + 1 + x0, y * rowLen + 1 + x1);
  }
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  ihdr.set([8, 0, 0, 0, 0], 8); // 8-bit, grey, deflate, no filter method, no interlace
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", await deflate(raw)),
    chunk("IEND", new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) (out.set(p, o), (o += p.length));
  return out;
}
