#!/usr/bin/env python3
"""Product lock: put the REAL product pixels into a layout, so its shape is right by construction.

Why: a model redraws a product from a photo and drifts (W46c: the jar came out 9% too squat, the cap too short).
A model keeps what is already in its input image. So we place the real product, cut from the packshot, at the exact
proportions, and the model only builds the scene around it (creative-playbook.md section 7.4).

Needs Python 3 with Pillow and numpy. Runs on the owner's machine or in the session, not in the Worker.

  skeleton  A blank canvas with N real products placed on it. Use it as the ONLY reference of a draft.
            Each draft gets its own placement, so the 3 drafts of an idea differ in layout, scale and crop.
  swap      Replace the product in an existing draft or final with the real one (repair of a picked draft).
            --lower-only keeps the scene above the label: for an open, almost empty jar (the packshot cannot show that
            state, so only the label and the base are real pixels).

--box is the product's silhouette in the packshot: x0,y0,x1,y1 in pixels (read it from a grid overlay of the packshot).
"""
import argparse
import sys

import numpy as np
from PIL import Image, ImageDraw

PAD = 4  # px of packshot kept around the silhouette, so the edge is not cut


def ints(s, n):
    v = [int(float(x)) for x in s.split(",")]
    if len(v) != n:
        sys.exit(f"expected {n} numbers: {s}")
    return v


def rgb(s):
    if s.startswith("#"):
        return tuple(int(s[i:i + 2], 16) for i in (1, 3, 5))
    return tuple(ints(s, 3))


def alpha(size, scale, square_top=False):
    """Rounded-rectangle mask, drawn at 4x and shrunk for a soft edge."""
    w, h = size
    m = Image.new("L", (w * 4, h * 4), 0)
    d = ImageDraw.Draw(m)
    ins = round(PAD * scale * 4)
    d.rounded_rectangle((ins, 0 if square_top else ins, w * 4 - ins, h * 4 - ins), radius=round(34 * scale * 4), fill=255)
    if square_top:
        d.rectangle((ins, 0, w * 4 - ins, h * 2), fill=255)
    return m.resize(size, Image.LANCZOS)


def cut(pack, box, band_top=None):
    x0, y0, x1, y1 = box
    top = band_top if band_top is not None else y0
    return pack.crop((x0 - PAD, top - PAD if band_top is None else top, x1 + PAD, y1 + PAD))


def skeleton(a):
    pack = Image.open(a.packshot).convert("RGB")
    W, H = ints(a.size, 2)
    x0, y0, x1, y1 = ints(a.box, 4)
    piece = cut(pack, (x0, y0, x1, y1))
    jar_h = round(H * a.jar_height)
    scale = jar_h / (y1 - y0 + 2 * PAD)
    piece = piece.resize((round(piece.width * scale), round(piece.height * scale)), Image.LANCZOS)
    mask = alpha(piece.size, scale)
    canvas = Image.new("RGB", (W, H), rgb(a.bg))
    pitch = piece.width * (1 + a.gap)
    total = pitch * (a.count - 1) + piece.width
    left = a.cx * W - total / 2
    top = round(a.base * H - piece.height + PAD * scale)
    for i in range(a.count):
        canvas.paste(piece, (round(left + i * pitch), top), mask)
    canvas.save(a.out, quality=95)
    print(f"{a.out}: product {piece.width}x{piece.height}px, H/W {(y1 - y0) / (x1 - x0):.3f}")


def swap(a):
    pack = Image.open(a.packshot).convert("RGB")
    scene = Image.open(a.scene).convert("RGB")
    x0, y0, x1, y1 = ints(a.box, 4)
    ox0, ox1, otop, obase = ints(a.old, 4)  # the old product in the scene: x0,x1,top,base (one product per call)
    arr = np.asarray(scene).astype(float)
    H, W = arr.shape[:2]
    if not (0 <= ox0 < ox1 <= W and 0 <= otop < obase <= H):
        sys.exit(f"--old {a.old} is outside the scene ({W}x{H}) or not x0<x1, top<base")
    cx = (ox0 + ox1) / 2
    if a.lower_only:
        if a.band_top is None:
            sys.exit("--lower-only needs --band-top (y of the label's top band in the packshot)")
        scale = (ox1 - ox0) / (x1 - x0 + 2 * PAD)
        piece = pack.crop((x0 - PAD, a.band_top, x1 + PAD, y1 + PAD))
    else:
        scale = (obase - otop) / (y1 - y0 + 2 * PAD)
        piece = pack.crop((x0 - PAD, y0 - PAD, x1 + PAD, y1 + PAD))
    piece = piece.resize((round(piece.width * scale), round(piece.height * scale)), Image.LANCZOS)
    mask = alpha(piece.size, scale, square_top=a.lower_only)
    ytop = obase - piece.height + round(PAD * scale)
    # Paint the old product's area with the backdrop (a blend of the columns just outside it), then paste the real one.
    pad, probe = 8, 14
    # lower-only keeps the scene above the pasted piece (the open neck and rim stay); a full swap clears the old product.
    fy0 = max(0, (ytop - 4) if a.lower_only else (min(otop, ytop) - 6))
    fy1 = min(H, obase + 8)
    fx0, fx1 = max(0, ox0 - pad), min(W, ox1 + pad)  # clip to the picture: a product at an edge must not wrap or crash
    lcols = arr[:, max(0, fx0 - probe):fx0]
    rcols = arr[:, fx1:fx1 + probe]
    if lcols.shape[1] == 0 and rcols.shape[1] == 0:
        sys.exit("the old product spans the whole width: there is no backdrop beside it to blend from")
    L = (lcols if lcols.shape[1] else rcols).mean(axis=1)  # an edge-touching product uses the one side that exists
    R = (rcols if rcols.shape[1] else lcols).mean(axis=1)
    for x in range(fx0, fx1):
        t = (x - fx0) / max(1, fx1 - fx0)
        arr[fy0:fy1, x] = L[fy0:fy1] * (1 - t) + R[fy0:fy1] * t
    out = Image.fromarray(arr.clip(0, 255).astype("uint8"))
    out.paste(piece, (round(cx - piece.width / 2), ytop), mask)
    out.save(a.out, quality=95)
    print(f"{a.out}: pasted {piece.width}x{piece.height}px at x={round(cx - piece.width / 2)} y={ytop}")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("skeleton")
    s.add_argument("--packshot", required=True)
    s.add_argument("--box", required=True, help="x0,y0,x1,y1 of the product in the packshot")
    s.add_argument("--size", default="1024x1280".replace("x", ","), help="W,H of the canvas (default 1024,1280)")
    s.add_argument("--bg", required=True, help="canvas colour: R,G,B or #rrggbb (the look's backdrop colour)")
    s.add_argument("--jar-height", type=float, required=True, help="product height, fraction of the canvas height")
    s.add_argument("--cx", type=float, default=0.5, help="centre x, fraction of the width")
    s.add_argument("--base", type=float, default=0.9, help="y of the product's base, fraction of the height")
    s.add_argument("--count", type=int, default=1)
    s.add_argument("--gap", type=float, default=0.18, help="gap between products, fraction of one product's width")
    s.add_argument("--out", required=True)
    s.set_defaults(fn=skeleton)
    w = sub.add_parser("swap")
    w.add_argument("--packshot", required=True)
    w.add_argument("--box", required=True)
    w.add_argument("--scene", required=True)
    w.add_argument("--old", required=True, help="x0,x1,top,base of the old product in the scene")
    w.add_argument("--lower-only", action="store_true")
    w.add_argument("--band-top", type=int, help="y of the label's top band in the packshot (with --lower-only)")
    w.add_argument("--out", required=True)
    w.set_defaults(fn=swap)
    a = p.parse_args()
    if a.cmd == "skeleton" and "x" in a.size:
        a.size = a.size.replace("x", ",")
    a.fn(a)


if __name__ == "__main__":
    main()
