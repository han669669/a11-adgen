#!/usr/bin/env python3
"""Exposure: one brightness gain on the whole picture, as a photographer sets exposure in a raw editor.

Why (owner, 27-11-2026, PopoMama engine 2 batch): the high final pass lit the box fronts 10 to 17% darker than the
picked draft, and he rejected the finals as too dark. A lift of each box face in code then looked pasted in: "doesnt
feel like the actual product's there". The approved finals came from a relit render and then one gain on the whole
picture. Never brighten one face or one object in code: fix the light in the render, then use this script.

It multiplies the luminance of every pixel by --gain. The colour ratios of each pixel stay the same, so no colour shifts.
Above --shoulder the luminance rolls off smoothly toward white, so a bright wall does not clip; a pixel whose brightest
channel would pass 255 is scaled down as a whole, so its hue stays. Measure the product fronts against the picked
draft (--measure), choose the gain from that, then run photo_finish.py and headline.py after it.

  python3 scripts/exposure.py --in <picture> --out <picture> --gain 1.12 [--shoulder 0.72]
  python3 scripts/exposure.py --in <final> --measure X0,Y0,X1,Y1 --ref <draft> --ref-box X0,Y0,X1,Y1

Needs Python 3 with Pillow and numpy (scripts/requirements.txt).
"""
import argparse
import sys

import numpy as np
from PIL import Image

LUMA = np.float32([0.299, 0.587, 0.114])


def expose(rgb, gain, shoulder=0.72):
    """rgb: float array in 0..1. One gain on the luminance, a soft shoulder above `shoulder`, hue kept on clip."""
    lum = rgb @ LUMA
    x = lum * gain
    s = shoulder
    rolled = np.where(x > s, s + (1 - s) * (1 - np.exp(-(x - s) / (1 - s))), x)
    out = rgb * (rolled / np.maximum(lum, 1e-4))[..., None]
    top = out.max(axis=-1, keepdims=True)
    return np.clip(np.where(top > 1, out / np.maximum(top, 1e-6), out), 0, 1)


def box(text):
    v = [int(t) for t in text.split(",")]
    if len(v) != 4 or v[2] <= v[0] or v[3] <= v[1] or min(v) < 0:
        raise ValueError
    return v


def front(path, b):
    """The mean luminance of a box in a picture, and the box's pixels (0..1)."""
    a = np.asarray(Image.open(path).convert("RGB")).astype(np.float32) / 255
    h, w = a.shape[:2]
    if b[2] > w or b[3] > h:
        sys.exit(f"the box {b} is outside {path} ({w}x{h})")
    crop = a[b[1]:b[3], b[0]:b[2]]
    return float((crop @ LUMA).mean()), crop


def saved_mean(crop, gain, shoulder):
    """The mean luminance of the crop after expose and the 8-bit save, as the final will measure."""
    return float((np.floor(expose(crop, gain, shoulder) * 255 + 0.5) / 255 @ LUMA).mean())


def match_gain(crop, want, shoulder, lo=0.5, hi=2.0):
    """The gain that brings the crop's mean to want, with the shoulder and the clip (it is not linear), or None."""
    if not (saved_mean(crop, lo, shoulder) <= want <= saved_mean(crop, hi, shoulder)):
        return None
    for _ in range(40):
        mid = (lo + hi) / 2
        lo, hi = (mid, hi) if saved_mean(crop, mid, shoulder) < want else (lo, mid)
    return hi


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--in", dest="src", required=True)
    p.add_argument("--out")
    p.add_argument("--gain", type=float)
    p.add_argument("--shoulder", type=float, default=0.72, help="luminance (0 to 1) where the soft roll-off starts")
    p.add_argument("--measure", help="X0,Y0,X1,Y1 of a product front in --in: print its brightness against --ref")
    p.add_argument("--ref", help="the picked draft")
    p.add_argument("--ref-box", help="X0,Y0,X1,Y1 of the same front in --ref (in the draft's own pixels)")
    a = p.parse_args(argv)
    if a.measure:
        if not (a.ref and a.ref_box):
            sys.exit("--measure needs --ref and --ref-box")
        try:
            mb, rb = box(a.measure), box(a.ref_box)
        except ValueError:
            sys.exit("a box is X0,Y0,X1,Y1 with X1 > X0 and Y1 > Y0")
        got, crop = front(a.src, mb)
        want, _ = front(a.ref, rb)
        diff = f"front brightness {got:.3f}, draft {want:.3f}: {100 * (got / max(want, 1e-4) - 1):+.1f}%"
        gain = match_gain(crop, want, a.shoulder)
        if gain is None:
            print(f"{diff}; no gain from 0.5 to 2.0 matches the draft: render it again with the scene relit")
        else:
            print(f"{diff}; a gain of {gain:.3f} matches the draft (with --shoulder {a.shoulder})")
        return 0
    if a.out is None or a.gain is None:
        sys.exit("give --out and --gain (or --measure with --ref and --ref-box)")
    if not (0.5 <= a.gain <= 2.0):
        sys.exit("--gain must be from 0.5 to 2.0: a bigger change is a new render, not an exposure step")
    if not (0.3 <= a.shoulder < 1.0):
        sys.exit("--shoulder must be from 0.3 to just under 1.0")
    rgb = np.asarray(Image.open(a.src).convert("RGB")).astype(np.float32) / 255
    out = expose(rgb, a.gain, a.shoulder)
    Image.fromarray((out * 255 + 0.5).astype(np.uint8)).save(a.out, quality=97, subsampling=0)
    print(f"{a.out}: exposure gain {a.gain}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
