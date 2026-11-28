#!/usr/bin/env python3
"""Patch merge: keep a real photo and take from a render only the areas that had to change.

Why (owner, 28-11-2026, Durian Delivery engine v1 batch): a model pass over a whole real crowd photo still read as AI
at first glance ("odd looking weird heads"). The approved final kept every pixel of the real photo and took from the
render only the areas that changed (the painting, two heads, a removed phone), pasted back with soft edges.

A render is rarely at the exact place of its reference: it can move a few pixels. So the script first finds the shift
of the render that best matches the real photo OUTSIDE the patches (the areas that must not change), and stops when no
shift matches well: then the render moved the composition, and it needs a new render that keeps it.

  python3 scripts/patch_merge.py --base <real photo> --render <render> --box X0,Y0,X1,Y1 [--ellipse X0,Y0,X1,Y1] \\
      --out <picture> [--feather 9] [--search 6] [--max-diff 14] [--debug mask.png]

The boxes and ellipses are in the pixels of --base. A render of another size with the same shape (1024x1280 against
1536x1920) is scaled to --base first. Run photo_finish.py and headline.py after it, as for any picture.

Needs Python 3 with Pillow and numpy (scripts/requirements.txt).
"""
import argparse
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

FORMATS = ["JPEG", "PNG", "WEBP"]


def box(text):
    v = [int(t) for t in text.split(",")]
    if len(v) != 4 or v[2] <= v[0] or v[3] <= v[1] or min(v) < 0:
        raise ValueError
    return v


def patch_mask(size, boxes, ellipses, radius=18):
    m = Image.new("L", size, 0)
    d = ImageDraw.Draw(m)
    for b in boxes:
        d.rounded_rectangle(b, radius=radius, fill=255)
    for e in ellipses:
        d.ellipse(e, fill=255)
    return m


def best_shift(base, render, keep, search, step=3):
    """The (dx, dy) for which render[y + dy, x + dx] best matches base[y, x] where keep is true, and the mean difference
    there (0 to 255, grey, after the median difference is taken away). Every step-th pixel is compared, so a search of 6 px stays fast on a 1536x1920 picture."""
    g0 = base @ np.float32([0.299, 0.587, 0.114])
    g1 = render @ np.float32([0.299, 0.587, 0.114])
    H, W = g0.shape
    s = search
    ys, xs = np.mgrid[s:H - s:step, s:W - s:step]
    sel = keep[ys, xs]
    ys, xs = ys[sel], xs[sel]
    if ys.size < 100:
        sys.exit("the patches cover almost the whole picture: nothing is left to align the render with")
    best = None
    for dy in range(-s, s + 1):
        for dx in range(-s, s + 1):
            e = g0[ys, xs] - g1[ys + dy, xs + dx]
            d = float(np.abs(e - np.median(e)).mean())   # a render often drifts a little in brightness: compare the shapes, not the level
            if best is None or d < best[0]:
                best = (d, dx, dy)
    return best[1], best[2], best[0]


def shifted(render, dx, dy, fill):
    """render moved so that out[y, x] = render[y + dy, x + dx]; the uncovered edge takes fill (the real photo)."""
    out = fill.copy()
    H, W = render.shape[:2]
    ys0, ys1 = max(0, -dy), min(H, H - dy)
    xs0, xs1 = max(0, -dx), min(W, W - dx)
    out[ys0:ys1, xs0:xs1] = render[ys0 + dy:ys1 + dy, xs0 + dx:xs1 + dx]
    return out


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--base", required=True, help="the real photo, at the size of the finished picture")
    p.add_argument("--render", required=True, help="the render made from that photo (any size with the same shape)")
    p.add_argument("--box", action="append", default=[], help="X0,Y0,X1,Y1 of an area to take from the render (repeat)")
    p.add_argument("--ellipse", action="append", default=[], help="X0,Y0,X1,Y1 of an oval area to take from the render, such as a head (repeat)")
    p.add_argument("--out", required=True)
    p.add_argument("--feather", type=float, default=9, help="blur of the patch edges, in px of --base")
    p.add_argument("--search", type=int, default=6, help="the largest shift of the render to try, in px of --base")
    p.add_argument("--max-diff", type=float, default=14, help="the largest mean grey difference outside the patches (0 to 255) after the best shift")
    p.add_argument("--debug", help="writes the paste mask (PNG) here")
    a = p.parse_args(argv)
    try:
        boxes, ellipses = [box(b) for b in a.box], [box(e) for e in a.ellipse]
    except ValueError:
        sys.exit("a box or an ellipse is X0,Y0,X1,Y1 with X1 > X0 and Y1 > Y0")
    if not boxes and not ellipses:
        sys.exit("give at least one --box or --ellipse: the areas to take from the render")
    if not (0 <= a.search <= 40):
        sys.exit("--search must be from 0 to 40 px")
    if not (0 <= a.feather <= 60):
        sys.exit("--feather must be from 0 to 60 px")
    base_im = Image.open(a.base, formats=FORMATS).convert("RGB")
    rend_im = Image.open(a.render, formats=FORMATS).convert("RGB")
    W, H = base_im.size
    if abs(rend_im.width / rend_im.height - W / H) > 0.01 * (W / H):
        sys.exit(f"the render ({rend_im.width}x{rend_im.height}) does not have the shape of --base ({W}x{H})")
    for b in boxes + ellipses:
        if b[2] > W or b[3] > H:
            sys.exit(f"the area {b} is outside --base ({W}x{H})")
    if rend_im.size != base_im.size:
        rend_im = rend_im.resize(base_im.size, Image.LANCZOS)
    base = np.asarray(base_im).astype(np.float32)
    rend = np.asarray(rend_im).astype(np.float32)
    mask = patch_mask(base_im.size, boxes, ellipses)
    # Align on the areas that must not change: outside the patches and their soft edge.
    grow = int(a.feather * 2) + 9
    keep = np.asarray(mask.filter(ImageFilter.MaxFilter(2 * (grow // 2) + 1))) == 0
    dx, dy, diff = best_shift(base, rend, keep, a.search)
    if diff > a.max_diff:
        sys.exit(f"the render does not match the real photo outside the patches (mean difference {diff:.1f} after the best shift "
                 f"{dx},{dy}; the limit is {a.max_diff}): it moved the composition. Render it again with \"keep the exact composition\".")
    moved = shifted(rend, dx, dy, base)
    soft = mask.filter(ImageFilter.GaussianBlur(a.feather)) if a.feather > 0 else mask
    if a.debug:
        soft.save(a.debug)
    w = np.asarray(soft).astype(np.float32)[..., None] / 255
    out = moved * w + base * (1 - w)
    Image.fromarray((out + 0.5).clip(0, 255).astype(np.uint8)).save(a.out, quality=97, subsampling=0)
    share = float((np.asarray(soft) > 127).mean())
    print(f"{a.out}: render shift {dx},{dy}, mean difference outside the patches {diff:.1f}; {100 * share:.1f}% of the picture from the render")
    return 0


if __name__ == "__main__":
    sys.exit(main())
