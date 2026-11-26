#!/usr/bin/env python3
"""Shape fix: measure the product in a render against the brand's packshot, and correct a small drift in code.

Why (owner, 26-11-2026, B/SKIN serum, engine 2): every model pass (a draft edit, a high final) made the bottle body 1
to 5% taller for its width, and the cap narrower than the real cap. He reads the shape against the brand's own photos
at once ("the bottle and cap not adhering to the actual dimensions of the brand supplied reference images"). Each
round needed a hand measure and a hand fix. This script does both before the owner sees a picture.

The product body is found by its own colour (the label colour, such as the kit's brand colour), from one point inside
it, in the render and in the packshot. Print on the body is filled in. Rows narrower than half the body's width are
left out at the top and the bottom (a curved shoulder, a soft base), and the width is the median of the middle rows,
so both pictures are measured in the same way. When the render's height over width differs from the packshot's by more
than --tolerance, the body (and the cap above it) is widened or narrowed about its centre with a smooth remap that
fades out into the backdrop. The height, the print height and everything else stay as they are.

With --cap-h (the cap's height over the body width, read from the packshot), the cap is measured too: its two side
edges are the strongest vertical edges in the cap rows. When the cap width over the body width differs from the
packshot's, only the cap rows are widened or narrowed about the body centre.

  python3 scripts/shape_fix.py --in <render> --out <picture> --body RRGGBB --at X,Y \\
      --packshot <packshot> --pack-at X,Y [--cap-h 0.44] [--tolerance 0.01] [--max-change 0.08]

A change larger than --max-change is refused: the render is wrong, not drifted, so make it again. The script prints
each ratio before and after, and exits with 1 when the result is still off, so a draft check can use it. A product
seen from the side or at an angle is not for this script: it is for a front-on body. Run it before
scripts/label_transfer.py and scripts/photo_finish.py. Needs Python 3 with Pillow, numpy and OpenCV
(scripts/requirements.txt).
"""
import argparse
import colorsys
import os
import sys

import cv2
import numpy as np
from PIL import Image


def hex_rgb(s, flag="--body"):
    h = s.strip().lstrip("#")
    if len(h) != 6 or any(c not in "0123456789abcdefABCDEF" for c in h):
        sys.exit(f"{flag} needs a colour as RRGGBB, not {s!r}")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def point(s, flag):
    try:
        x, y = (int(round(float(v))) for v in s.split(","))
    except ValueError:
        sys.exit(f"{flag} needs X,Y in pixels, not {s!r}")
    return x, y


def open_rgb(path):
    if not os.path.isfile(path):
        sys.exit(f"no picture at {path}")
    try:
        with Image.open(path) as im:
            return np.asarray(im.convert("RGB")).astype(np.float32)
    except OSError as e:
        sys.exit(f"cannot read the picture {path}: {e}")


def colour_mask(rgb, colour):
    """True where a pixel has the body colour's hue (its light and its shade both count)."""
    h0, s0, v0 = colorsys.rgb_to_hsv(*(c / 255 for c in colour))
    if s0 < 0.25:
        sys.exit("--body must be a clear colour (the label's colour), not a grey, a white or a cream: this script finds the body by its hue; on a white or pale label, patch the print from the packshot locally")
    a = rgb / 255
    mx, mn = a.max(2), a.min(2)
    d = np.maximum(mx - mn, 1e-6)
    s = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    h = np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) / 6
    dh = np.abs(h - h0)
    dh = np.minimum(dh, 1 - dh)
    return (dh < 0.05) & (s > 0.45 * s0) & (mx > 0.25 * v0)


def body_region(rgb, colour, at, flag="--at"):
    """The body that holds `at`: its mask (print filled in), width, centre, top and bottom rows."""
    H, W = rgb.shape[:2]
    x, y = at
    m = colour_mask(rgb, colour).astype(np.uint8)
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
    if not (0 <= x < W and 0 <= y < H) or not m[y, x]:
        sys.exit(f"{flag} {x},{y} is not on the body colour (it is outside the body or on its print): give a point on the plain label colour")
    _, lab = cv2.connectedComponents(m)
    body = (lab == lab[y, x]).astype(np.uint8)
    outside = body.copy()
    cv2.floodFill(outside, np.zeros((H + 2, W + 2), np.uint8), (0, 0), 1)
    body = (body | (1 - outside)).astype(bool)  # the print and any dark mark inside the body count as body
    widths = body.sum(1)
    rows = np.nonzero(widths)[0]
    wide = rows[widths[rows] >= 0.5 * widths.max()]
    top, bot = int(wide.min()), int(wide.max())
    mid = range(top + (bot - top) // 4, bot - (bot - top) // 4 + 1)
    lefts = [np.nonzero(body[r])[0].min() for r in mid]
    rights = [np.nonzero(body[r])[0].max() for r in mid]
    left, right = float(np.median(lefts)), float(np.median(rights))
    bw = right - left + 1
    if bw < 20 or bot - top < 20:
        sys.exit(f"the body found from {flag} is under 20 px: give a point on the product's label colour")
    return {"mask": body, "w": bw, "cx": (left + right) / 2, "top": top, "bot": bot, "hw": (bot - top + 1) / bw}


def remeasure(rgb, colour, at):
    """The body again after a fix, from the label pixel nearest the first point (a fix can move the point onto print)."""
    m = colour_mask(rgb, colour)
    ys, xs = np.nonzero(m)
    i = int(np.argmin((xs - at[0]) ** 2 + (ys - at[1]) ** 2))
    return body_region(rgb, colour, (int(xs[i]), int(ys[i])))


def cap_width(rgb, d, cap_h):
    """The cap's width: the strongest vertical edges left and right of the body centre, in the cap's middle rows."""
    lum = cv2.GaussianBlur(rgb @ np.array([0.299, 0.587, 0.114], np.float32), (0, 0), 1)
    gx = np.abs(cv2.Sobel(lum, cv2.CV_32F, 1, 0, ksize=3))
    w, cx, top = d["w"], d["cx"], d["top"]
    y0, y1 = int(top - 0.75 * cap_h * w), int(top - 0.15 * cap_h * w)
    if y0 < 0 or y1 <= y0:
        sys.exit("the cap rows reach past the picture's top edge: check --cap-h")
    prof = gx[y0:y1].sum(0)
    xl = np.arange(max(int(cx - 0.6 * w), 0), int(cx - 0.12 * w))
    xr = np.arange(int(cx + 0.12 * w), min(int(cx + 0.6 * w), rgb.shape[1] - 1))
    if len(xl) == 0 or len(xr) == 0:
        sys.exit("the cap's side edges are outside the picture")
    return float(xr[np.argmax(prof[xr])] - xl[np.argmax(prof[xl])])


def widen(rgb, cx, y0, y1, half, k, band):
    """Scale columns about cx by k in rows y0..y1 (soft row ends), fading to no change over `band` px past the edge."""
    H, W = rgb.shape[:2]
    ys = np.arange(H, dtype=np.float32)[:, None]
    xs = np.arange(W, dtype=np.float32)[None, :]
    kv = 1 + (k - 1) * np.clip((ys - (y0 - 4)) / 4, 0, 1) * np.clip((y1 + 4 - ys) / 4, 0, 1)
    u = xs - cx
    e = half * k + 3
    inner = u * (1 - 1 / kv)
    outer = np.sign(u) * e * (1 - 1 / kv) * (1 - np.clip((np.abs(u) - e) / band, 0, 1))
    disp = np.where(np.abs(u) <= e, inner, outer)
    mapx = (xs - disp).astype(np.float32)
    mapy = np.broadcast_to(ys, (H, W)).astype(np.float32)
    return cv2.remap(rgb, mapx, mapy, cv2.INTER_CUBIC, borderMode=cv2.BORDER_REFLECT)


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--in", dest="src", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--body", required=True, help="the body's label colour, RRGGBB (the kit's brand colour on a yellow bottle)")
    p.add_argument("--at", required=True, help="X,Y: a point on the plain label colour in the render")
    p.add_argument("--packshot", required=True, help="the brand's packshot, front-on")
    p.add_argument("--pack-at", required=True, help="X,Y: a point on the plain label colour in the packshot")
    p.add_argument("--cap-h", type=float, default=None, help="the cap's height over the body width, from the packshot: also match the cap width")
    p.add_argument("--tolerance", type=float, default=0.01, help="a relative difference that needs no fix")
    p.add_argument("--max-change", type=float, default=0.08, help="refuse a larger fix: make the render again")
    a = p.parse_args(argv)
    if not 0 < a.tolerance < 0.1 or not a.tolerance < a.max_change <= 0.15:
        sys.exit("--tolerance must be more than 0 and under 0.1, --max-change more than --tolerance and at most 0.15")
    if a.cap_h is not None and not 0.05 <= a.cap_h <= 2:
        sys.exit("--cap-h must be from 0.05 to 2 (the cap's height over the body width)")
    colour = hex_rgb(a.body)
    rgb, pack = open_rgb(a.src), open_rgb(a.packshot)
    at = point(a.at, "--at")
    r, q = body_region(rgb, colour, at), body_region(pack, colour, point(a.pack_at, "--pack-at"), "--pack-at")
    k = r["hw"] / q["hw"]  # > 1: the render's body is too narrow for its height
    print(f"body height/width: render {r['hw']:.3f}, packshot {q['hw']:.3f} ({100 * (k - 1):+.1f}%)")
    if abs(k - 1) > a.max_change:
        sys.exit(f"the body is {100 * abs(k - 1):.1f}% off the packshot, more than --max-change {100 * a.max_change:.0f}%: make the render again")
    out = rgb
    cap_top = r["top"] - (a.cap_h * r["w"] if a.cap_h else 0)
    if abs(k - 1) > a.tolerance:
        out = widen(out, r["cx"], cap_top, r["bot"], 0.5 * r["w"], k, 0.3 * r["w"])
        print(f"body widened x{k:.4f} about its centre")
    if a.cap_h:
        d = remeasure(out, colour, at)
        want = cap_width(pack, q, a.cap_h) / q["w"]
        have = cap_width(out, d, a.cap_h) / d["w"]
        print(f"cap width/body width: render {have:.3f}, packshot {want:.3f} ({100 * (have / want - 1):+.1f}%)")
        c = want / have
        if abs(c - 1) > a.max_change:
            sys.exit(f"the cap is {100 * abs(c - 1):.1f}% off the packshot, more than --max-change {100 * a.max_change:.0f}%: make the render again")
        if abs(c - 1) > a.tolerance:
            out = widen(out, d["cx"], d["top"] - a.cap_h * d["w"], d["top"] - 1, 0.5 * have * d["w"], c, 0.25 * d["w"])
            print(f"cap widened x{c:.4f} about the body centre")
    Image.fromarray(np.clip(out + 0.5, 0, 255).astype(np.uint8)).save(a.out, quality=95)
    d = remeasure(out, colour, at)
    off = d["hw"] / q["hw"] - 1
    msg = f"{a.out}: body height/width {d['hw']:.3f} ({100 * off:+.1f}% against the packshot)"
    if a.cap_h:
        cw = cap_width(out, d, a.cap_h) / d["w"]
        coff = cw / (cap_width(pack, q, a.cap_h) / q["w"]) - 1
        msg += f", cap width/body width {cw:.3f} ({100 * coff:+.1f}%)"
        off = max(abs(off), abs(coff))
    print(msg)
    if abs(off) > 2 * a.tolerance:
        print("STILL OFF: check the picture at full size")
        sys.exit(1)


if __name__ == "__main__":
    main()
