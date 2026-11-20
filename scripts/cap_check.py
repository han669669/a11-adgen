#!/usr/bin/env python3
"""Cap check: does the cap (or lid, or neck) of a bottle sit on the centre of its body?

Why (owner, 20-11-2026, Allies of Skin engine 3 test): the draft had the cap centred, but the high-quality final moved
it 5.5 px to the right of the body centre at 1536 px wide, and he saw it at once: "the bottle cap and the body doesn't
align properly ... theres more left sided space compared to right sided space". A final is a new picture: measure it
again.

The script reads each row of a box round the bottle. The bottle must stand on a plain stage that is lighter than the
bottle on both sides of the box. In each row it finds the left and the right edge of the bottle from the outside in:
the first pixel darker than the middle between the stage and the bottle, so print, glare and highlights inside the
bottle do not count. The rows are cut into parts wherever the width or the centre jumps. The body is the widest
part of at least a quarter of the rows of the longest part (a tapered body stays one part), so a short, wide contact
shadow is not the body and a tall cap is not either. Each part above the body from 50% to 90% of the body width (a
cap, a neck) is judged on its own; parts shorter than 8 rows (a clip, a shadow line) do not count. It prints the worst part's centre against the body centre and fails when the
difference is over --tolerance of the body width (default 1%). A prop that touches the bottle inside the box
moves an edge: make the box miss it, or judge by eye.

  python3 scripts/cap_check.py --render <picture> --box X0,Y0,X1,Y1 [--tolerance 0.01]

Needs Python 3 with Pillow and numpy (scripts/requirements.txt).
"""
import argparse
import sys

import numpy as np
from PIL import Image


def edges(lum):
    """Left and right edge of a dark object on a lighter stage, per row (-1 where the row has no object)."""
    stage = np.median(np.concatenate([lum[:, :4], lum[:, -4:]], 1), 1)
    dark = np.percentile(lum, 10, axis=1)
    mid = (stage + dark) / 2
    inside = (lum < mid[:, None]) & ((stage - dark) > 40)[:, None]
    has = inside.any(1)
    left = np.where(has, np.argmax(inside, 1), -1)
    right = np.where(has, lum.shape[1] - 1 - np.argmax(inside[:, ::-1], 1), -1)
    return left, right


def offset(left, right):
    """The worst narrower part (a cap, a lid, a neck) against the body centre: (offset in px, body width, first row,
    last row), or None without a narrower part.

    The rows are cut into parts wherever the width or the centre jumps, so a tapered body stays one part, and a cap,
    a neck and a contact shadow each become parts of their own. The body is the widest part of at least a quarter of the
    rows of the longest part, so a short, wide contact shadow is not the body and a tall cap is not either. Its width
    is the median of its row widths, and its centre is the median centre of its rows at that width. The rows above the
    first full-width row and from 50% to 90% of the body width are then cut again at each jump, so a smooth shoulder
    still leaves the cap as a part of its own, and each part is judged on its own: a long centred neck cannot hide a
    short shifted cap."""
    width = np.where(left >= 0, right - left + 1, 0)
    if width.max() == 0:
        sys.exit("no bottle found in the box: the stage must be lighter than the bottle on both sides")
    centre = (left + right) / 2
    parts, start = [], None
    for y in range(len(width) + 1):
        cut = y == len(width) or width[y] == 0 or (start is not None and (
            abs(width[y] - width[y - 1]) > 0.03 * max(width[y], width[y - 1])
            or abs(centre[y] - centre[y - 1]) > 2.5))
        if cut and start is not None:
            parts.append((start, y - 1))
            start = None
        if y < len(width) and width[y] > 0 and start is None:
            start = y
    rows = lambda p: p[1] - p[0] + 1
    longest = max(rows(p) for p in parts)
    tall = [p for p in parts if rows(p) >= max(10, 0.25 * longest)]
    if not tall:
        return None
    body = max(tall, key=lambda p: np.median(width[p[0]:p[1] + 1]))
    bw = float(np.median(width[body[0]:body[1] + 1]))
    full = np.zeros(len(width), bool)
    full[body[0]:body[1] + 1] = np.abs(width[body[0]:body[1] + 1] - bw) <= 0.03 * bw
    if full.sum() < 10:
        return None
    body_c = float(np.median(centre[full]))
    top = int(np.argmax(full))  # the first row at the full body width
    narrow = (width >= 0.5 * bw) & (width <= 0.9 * bw) & (np.arange(len(width)) < top)
    worst, start = None, None
    for y in range(top + 1):
        cut = y == top or not narrow[y] or (start is not None and (
            abs(width[y] - width[y - 1]) > 0.03 * bw or abs(centre[y] - centre[y - 1]) > 2.5))
        if cut and start is not None:
            if y - start >= 8:  # shorter: a clip, an edge or a shadow line
                off = float(np.median(centre[start:y])) - body_c
                if worst is None or abs(off) > abs(worst[0]):
                    worst = (off, bw, start, y - 1)
            start = None
        if y < top and narrow[y] and start is None:
            start = y
    return worst


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--render", required=True)
    ap.add_argument("--box", required=True, help="X0,Y0,X1,Y1 in pixels: the bottle with some plain stage on both sides")
    ap.add_argument("--tolerance", type=float, default=0.01, help="the share of the body width the cap may sit off centre")
    a = ap.parse_args(argv)
    try:
        x0, y0, x1, y1 = (int(v) for v in a.box.split(","))
    except ValueError:
        sys.exit("--box needs X0,Y0,X1,Y1 in whole pixels")
    try:
        im = Image.open(a.render).convert("L")
    except OSError as e:
        sys.exit(f"cannot read the picture {a.render}: {e}")
    if not (0 <= x0 < x1 <= im.width and 0 <= y0 < y1 <= im.height) or x1 - x0 < 20 or y1 - y0 < 20:
        sys.exit(f"--box {a.box} is not inside the {im.width} x {im.height} picture, or is too small")
    lum = np.asarray(im.crop((x0, y0, x1, y1))).astype(np.float32)
    r = offset(*edges(lum))
    if r is None:
        sys.exit("no cap found: the box needs the cap and the body (a cap 50% to 90% of the body width)")
    off, bw, r0, r1 = r
    ok = abs(off) <= a.tolerance * bw
    side = "right" if off > 0 else "left"
    print(f"cap centre {abs(off):.1f} px {side} of the body centre ({abs(off) / bw:.1%} of the {bw:.0f} px body; the part in rows {y0 + r0} to {y0 + r1}); {'PASS' if ok else 'FAIL'} at {a.tolerance:.0%}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
