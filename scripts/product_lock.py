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
    cx = a.cx if a.cx is not None else (ox0 + ox1) / 2
    if a.scale is not None:  # same scale for pieces that must keep their real size next to each other (a jar and its cap)
        scale = a.scale
        piece = pack.crop((x0 - PAD, y0 - PAD, x1 + PAD, y1 + PAD))
    elif a.lower_only:
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


def pad45(a):
    """Pad a square packshot to 4:5 (the model edits 4:5 only) by repeating its edge rows, so its pixels keep their x and shift down."""
    im = np.asarray(Image.open(a.packshot).convert("RGB"))
    h, w = im.shape[:2]
    extra = round(w * 5 / 4) - h
    if extra < 0 or extra % 2:
        sys.exit(f"packshot {w}x{h}: cannot pad to 4:5 with equal rows")
    Image.fromarray(np.pad(im, ((extra // 2, extra // 2), (0, 0), (0, 0)), mode="edge")).save(a.out, quality=95)
    print(f"{a.out}: padded {extra // 2} px at the top and bottom, size {w}x{h + extra}; packshot y + {extra // 2} = padded y")


def open_source(a):
    """Build the source for an OPEN product from a model edit of the padded packshot (cap removed, same framing).
    The model gives the open neck at the packshot's own camera angle. Everything from --real-from down is the real photo again
    (the cut hides inside the label's solid top band), and one strip of repeated threads is added so the neck reaches its true height."""
    pad = Image.open(a.padded).convert("RGB")
    edit = Image.open(a.edit).convert("RGB").resize(pad.size, Image.LANCZOS)
    E, P = np.asarray(edit).copy(), np.asarray(pad)
    E[a.real_from:] = P[a.real_from:]
    s0, s1 = ints(a.strip, 2)
    strip = E[s0:s1 + 1].copy()
    n = strip.shape[0]
    ext = np.concatenate([E[:s1 + 1], strip, E[s1 + 1:]], axis=0)[n:]  # the top n rows are plain backdrop: the base keeps its y
    Image.fromarray(ext).save(a.out, quality=95)
    print(f"{a.out}: neck extended by {n} px; the rim moved up {n} px; the box top is the old rim y minus {n}")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    d = sub.add_parser("pad45", help="pad a square packshot to 4:5 for a model edit")
    d.add_argument("--packshot", required=True)
    d.add_argument("--out", required=True)
    d.set_defaults(fn=pad45)
    o = sub.add_parser("open-source", help="real photo + a model-drawn open neck at the same camera angle (a cap-off product)")
    o.add_argument("--padded", required=True, help="the padded packshot that was sent to the model")
    o.add_argument("--edit", required=True, help="the model's edit of it (cap off, same framing)")
    o.add_argument("--real-from", type=int, required=True, help="padded y inside the label's top band: from here down the real photo is used")
    o.add_argument("--strip", required=True, help="y0,y1 of a strip of the neck's threads to repeat (a whole number of thread periods)")
    o.add_argument("--out", required=True)
    o.set_defaults(fn=open_source)
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
    w.add_argument("--scale", type=float, help="paste at this scale (packshot pixels to scene pixels) instead of fitting --old")
    w.add_argument("--cx", type=float, help="centre x of the pasted piece (default: the centre of --old)")
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
