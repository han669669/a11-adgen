#!/usr/bin/env python3
"""Cap check: does the cap (or lid, or neck) of a bottle sit on the centre of its body?

Why (owner, 20-11-2026, Allies of Skin engine 3 test): the draft had the cap centred, but the high-quality final moved
it 5.5 px to the right of the body centre at 1536 px wide, and he saw it at once: "the bottle cap and the body doesn't
align properly ... theres more left sided space compared to right sided space". A final is a new picture: measure it
again.

The script reads each row of a box round the bottle. The bottle must stand on a plain stage that is lighter than the
bottle on both sides of the box. In each row it finds the left and the right edge of the bottle from the outside in:
the first pixel darker than the middle between the stage and the bottle, so print, glare and highlights inside the
bottle do not count. Rows at least 90% as wide as the widest row are the body; rows from 50% to 85% of it are the cap
(a clip or a shadow line is narrower and does not count). It prints the cap centre against the body centre and fails
when the difference is over --tolerance of the body width (default 1%). A prop that touches the bottle inside the box
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
    """The cap centre minus the body centre, in pixels, and the body width; None without a narrower top part."""
    width = np.where(left >= 0, right - left + 1, 0)
    wmax = width.max()
    if wmax == 0:
        sys.exit("no bottle found in the box: the stage must be lighter than the bottle on both sides")
    centre = (left + right) / 2
    body = width >= 0.9 * wmax
    cap = (width >= 0.5 * wmax) & (width < 0.85 * wmax)
    if cap.sum() < 10 or body.sum() < 10:
        return None
    return float(np.median(centre[cap]) - np.median(centre[body])), float(np.median(width[body]))


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
        sys.exit("no cap found: the box needs the cap and the body (a cap 50% to 85% of the body width)")
    off, bw = r
    ok = abs(off) <= a.tolerance * bw
    side = "right" if off > 0 else "left"
    print(f"cap centre {abs(off):.1f} px {side} of the body centre ({abs(off) / bw:.1%} of the {bw:.0f} px body); {'PASS' if ok else 'FAIL'} at {a.tolerance:.0%}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
