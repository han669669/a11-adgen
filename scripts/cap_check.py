#!/usr/bin/env python3
"""Cap check: does the cap (or lid, or neck) of a bottle sit on the centre of its body?

Why (owner, 20-11-2026, Allies of Skin engine 3 test): the draft had the cap centred, but the high-quality final moved
it 5.5 px to the right of the body centre at 1536 px wide, and he saw it at once: "the bottle cap and the body doesn't
align properly ... theres more left sided space compared to right sided space". A final is a new picture: measure it
again.

The script reads each row of a box round the bottle. The bottle must stand on a plain stage that is lighter than the
bottle on both sides of the box. In each row it finds the left and the right edge of the bottle from the outside in:
the first pixel darker than the middle between the stage and the bottle, so print, glare and highlights inside the
bottle do not count. You give the first row below the cap and the neck (--split, read off the picture): no rule
guesses where a cap ends, because a tall cap, a taper or a smooth shoulder fools every guess. A shoulder belongs to
the body, so --split is the top of the shoulder, not its foot. The body is the rows from --split to the bottom of the
box; its width and its centre are the medians of those rows, so a taper, a shoulder or a rounded base does not move
them. End the box at the base of the bottle, above any contact shadow. The rows above --split are cut into parts
wherever the width jumps by more than 3% or the centre by more than 2.5 px (a cap, a neck, a collar), and each part of
8 rows or more is judged on its own, so a long centred neck cannot hide a short shifted cap. It prints the worst part's
centre against the body centre and fails when the difference is over --tolerance of the body width (default 1%). A
prop that touches the bottle inside the box moves an edge: make the box miss it, or judge by eye.

  python3 scripts/cap_check.py --render <picture> --box X0,Y0,X1,Y1 --split Y [--tolerance 0.01]

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


def split_rows(width, centre, keep):
    """Runs of kept rows, cut wherever the width jumps by more than 3% or the centre by more than 2.5 px."""
    parts, start = [], None
    for y in range(len(width) + 1):
        cut = y == len(width) or not keep[y] or (start is not None and (
            abs(width[y] - width[y - 1]) > 0.03 * max(width[y], width[y - 1])
            or abs(centre[y] - centre[y - 1]) > 2.5))
        if cut and start is not None:
            parts.append((start, y - 1))
            start = None
        if y < len(width) and keep[y] and start is None:
            start = y
    return parts


def offset(left, right, split):
    """The worst part above the body (a cap, a lid, a neck) against the body centre: (offset in px, body width, first
    row, last row), or None when the box has no part of 8 rows or more above row `split` or under 10 body rows."""
    width = np.where(left >= 0, right - left + 1, 0)
    if width.max() == 0:
        sys.exit("no bottle found in the box: the stage must be lighter than the bottle on both sides")
    centre = (left + right) / 2
    rows = np.arange(len(width))
    body = (rows >= split) & (width > 0)
    if body.sum() < 10:
        return None
    bw = float(np.median(width[body]))
    body_c = float(np.median(centre[body]))
    worst = None
    for a, b in split_rows(width, centre, (rows < split) & (width > 0)):
        if b - a + 1 < 8:
            continue  # a clip, an edge or a shadow line
        off = float(np.median(centre[a:b + 1])) - body_c
        if worst is None or abs(off) > abs(worst[0]):
            worst = (off, bw, a, b)
    return worst


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--render", required=True)
    ap.add_argument("--box", required=True, help="X0,Y0,X1,Y1 in pixels: the bottle with some plain stage on both sides")
    ap.add_argument("--split", required=True, type=int, help="Y in pixels: the first row below the cap and the neck (the top of any shoulder)")
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
    if not y0 < a.split < y1:
        sys.exit(f"--split {a.split} is not inside the box rows {y0} to {y1}")
    lum = np.asarray(im.crop((x0, y0, x1, y1))).astype(np.float32)
    r = offset(*edges(lum), a.split - y0)
    if r is None:
        sys.exit("no cap found: the box needs a cap of 8 rows or more above --split and 10 body rows or more below it")
    off, bw, r0, r1 = r
    ok = abs(off) <= a.tolerance * bw
    side = "right" if off > 0 else "left"
    print(f"cap centre {abs(off):.1f} px {side} of the body centre ({abs(off) / bw:.1%} of the {bw:.0f} px body; the part in rows {y0 + r0} to {y0 + r1}); {'PASS' if ok else 'FAIL'} at {a.tolerance:.0%}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
