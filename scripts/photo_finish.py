#!/usr/bin/env python3
"""Photo finish: make a rendered ad picture read as a photo from a real camera, not as an AI render.

Why (owner, 15-11-2026): he liked the light film grain on the W46 Sonnet finals and asked for more of the traits of a
real professional camera, so that no viewer thinks "AI image" at first glance. An image model gives a picture that is
too clean: no sensor or film grain, the same crisp edge everywhere, clipped digital highlights, colour that is a little
too saturated and no lens traits. This script adds those traits back, in the order a colourist uses (tone and colour
first, then a light softening, lens traits, and the grain last, so that no later step smears the grain):

  1. tone      a soft highlight shoulder (no hard digital white), a small lift of the deepest blacks, and a trim of
               the most saturated colours only (people see over-saturation as "AI").
  2. soften    a very light blur blended in, which removes the model's over-sharpened edges and halos.
  3. halation  a faint warm glow round the brightest highlights, as light scatters in film.
  4. lens      a natural vignette (corners a little darker), a lateral colour fringe that grows to the corners
               (under 1 px at 1536 px) and corners a little softer than the centre.
  5. grain     organic grain (clumped, not one-pixel noise), strongest in the mid-tones and weakest in deep shadows
               and bright highlights, as in real film; mostly luminance with a little colour.

Run it on the picture before the words go on: the ad's type is set in post on a real shoot too, so it stays crisp
(headline.py runs after this script). On a composed final the logo is already in: pass its box with --sharp so the
soften and lens steps leave it crisp (tone and grain still run there, so no edge shows on the backdrop). Then give
compose_final grain "off" on that final: this script makes the grain.

--keep HEX keeps a brand colour exact (owner, 18-11-2026: the tone step turned the Fickle Feline brand yellow olive,
because the highlight shoulder pulls the red channel down more than the green). Pixels near that colour skip the
tone and halation steps; the soften, lens and grain steps still run there, so the backdrop reads as the same photo.
Use it on an engine 3 brand-colour stage with the kit's brand colour.

  python3 scripts/photo_finish.py --in <picture> --out <picture> [--strength 1] [--sharp x0,y0,x1,y1] [--keep HEX] [--no-STEP]

Sizes scale with the picture width (the numbers are tuned at 1536 px, the final width), so a 1024 px draft gets
the same look at its size. --seed makes the grain the same on each run. Needs Python 3 with Pillow, numpy and
OpenCV (scripts/requirements.txt).
"""
import argparse
import os
import sys

import numpy as np
from PIL import Image

FORMATS = ["JPEG", "PNG", "WEBP"]
KEEP_NEAR, KEEP_FAR = 0.06, 0.14  # --keep: RGB distance (0..1) fully kept, and where the normal finish is back
REF_WIDTH = 1536  # the final's width; sizes below are in pixels at this width

STEPS = ("tone", "soften", "halation", "lens", "grain")

# Default amounts at --strength 1 (checked by eye at full size on the W46 Sonnet finals, 15-11-2026).
DEFAULTS = {
    "shoulder": 0.78,     # tone: highlights above this (0..1) roll off softly towards white
    "white": 0.975,       # tone: the level the shoulder approaches (full white lands at about 0.91: no clipped digital white)
    "black": 0.012,       # tone: the deepest output value (a slight lift, as on a print)
    "sat_trim": 0.07,     # tone: how much the most saturated colours lose (s -> s * (1 - k * s^2))
    "soften_px": 0.7,     # soften: blur sigma
    "soften_mix": 0.35,   # soften: how much of the blur is blended in
    "halation_thr": 0.86, # halation: brightness where the glow starts
    "halation_px": 14.0,  # halation: glow radius
    "halation_mix": 0.06, # halation: glow strength
    "vignette": 0.06,     # lens: light lost at the far corners
    "fringe_px": 0.8,     # lens: red/blue shift at the far corners
    "edge_soft_px": 0.9,  # lens: extra blur at the far corners
    "grain_amp": 0.013,   # grain: noise in the mid-tones, as a share of full scale
    "grain_px": 0.55,     # grain: clump size (blur sigma of the noise)
    "grain_chroma": 0.15, # grain: colour noise, as a share of the luminance noise
}


def check_params(p):
    """Stop with a clear message on a tuning value that the formulas cannot take."""
    for name, val in p.items():
        if not np.isfinite(val) or val < 0:
            sys.exit(f"--{name.replace('_', '-')} must be a finite number of 0 or more, got {val}")
    if not p["black"] < p["shoulder"] < p["white"] <= 1:
        sys.exit("tone needs black < shoulder < white <= 1")
    if not p["halation_thr"] < 1:
        sys.exit("--halation-thr must be less than 1")
    for name in ("sat_trim", "soften_mix", "halation_mix", "vignette"):
        if p[name] > 1:
            sys.exit(f"--{name.replace('_', '-')} must be from 0 to 1")


def need_cv2():
    try:
        import cv2  # noqa: F401
    except ImportError:
        sys.exit("photo_finish.py needs OpenCV: python3 -m pip install -r scripts/requirements.txt")
    import cv2
    return cv2


def box_fracs(s):
    try:
        v = [float(x) for x in s.split(",")]
    except ValueError:
        sys.exit(f"--sharp needs x0,y0,x1,y1 as fractions: {s}")
    if len(v) != 4 or not (0 <= v[0] < v[2] <= 1 and 0 <= v[1] < v[3] <= 1):
        sys.exit(f"--sharp needs x0,y0,x1,y1 as fractions from 0 to 1 with x0<x1 and y0<y1: {s}")
    return v


def luma(a):
    return a[..., 0] * 0.2126 + a[..., 1] * 0.7152 + a[..., 2] * 0.0722


def tone(a, p, k):
    """Soft highlight shoulder, a small black lift and a trim of only the most saturated colours."""
    s0, white, black = p["shoulder"], p["white"], p["black"]
    # Shoulder: below s0 unchanged; above it an exponential approach to `white` with matching slope at s0.
    span = white - s0
    over = np.maximum(a - s0, 0)
    rolled = np.where(a > s0, s0 + span * (1 - np.exp(-over / span)), a)
    out = a + (rolled - a) * k
    out = black * k + out * (1 - black * k)
    # Saturation trim around each pixel's own luminance; a grey stays grey.
    y = luma(out)[..., None]
    mx, mn = out.max(-1, keepdims=True), out.min(-1, keepdims=True)
    sat = (mx - mn) / np.maximum(mx, 1e-4)
    keep = 1 - p["sat_trim"] * k * sat ** 2
    return np.clip(y + (out - y) * keep, 0, 1)


def soften(a, p, k, scale, sharp, cv2):
    sig = p["soften_px"] * scale
    blur = cv2.GaussianBlur(a, (0, 0), sig)
    mix = p["soften_mix"] * k * (1 - sharp)[..., None]
    return a + (blur - a) * mix


def halation(a, p, k, scale, cv2):
    y = luma(a)
    hi = np.clip((y - p["halation_thr"]) / (1 - p["halation_thr"]), 0, 1)
    glow = cv2.GaussianBlur(hi.astype(np.float32), (0, 0), p["halation_px"] * scale)
    tint = np.array([1.0, 0.42, 0.18], np.float32)  # warm red-orange, as film halation
    add = glow[..., None] * tint * p["halation_mix"] * k
    return 1 - (1 - a) * (1 - add)  # screen blend: it can only brighten, never clip hard


def radius(h, w):
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    cx, cy = (w - 1) / 2, (h - 1) / 2
    r = np.hypot(xx - cx, yy - cy) / np.hypot(cx, cy)  # 0 at the centre, 1 at the far corners
    return r, xx, yy, cx, cy


def lens(a, p, k, scale, sharp, cv2):
    h, w = a.shape[:2]
    r, xx, yy, cx, cy = radius(h, w)
    # Lateral colour fringe: red a little larger and blue a little smaller than green, growing with the radius.
    out = a.copy()
    corner = np.hypot(cx, cy)
    for ch, sign in ((0, 1.0), (2, -1.0)):
        f = 1 + sign * p["fringe_px"] * scale * k / corner
        mx = (cx + (xx - cx) / f).astype(np.float32)
        my = (cy + (yy - cy) / f).astype(np.float32)
        out[..., ch] = cv2.remap(a[..., ch], mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
    out = a + (out - a) * (1 - sharp)[..., None]
    # Corners a little softer than the centre (no lens is sharp to the corners).
    soft = cv2.GaussianBlur(out, (0, 0), p["edge_soft_px"] * scale)
    m = (np.clip((r - 0.55) / 0.45, 0, 1) ** 2 * k * (1 - sharp))[..., None]
    out = out + (soft - out) * m
    # Vignette: a smooth cos^4-like fall-off, only in the outer part of the frame.
    v = 1 - p["vignette"] * k * np.clip((r - 0.35) / 0.65, 0, 1) ** 2
    return out * v[..., None]


def grain(a, p, k, scale, rng, cv2):
    h, w = a.shape[:2]
    sig = max(p["grain_px"] * scale, 0.3)

    def field():
        n = rng.standard_normal((h, w)).astype(np.float32)
        n = cv2.GaussianBlur(n, (0, 0), sig)
        return n / max(float(n.std()), 1e-6)

    y = luma(a)
    # Strongest in the mid-tones, weaker in the deep shadows and bright highlights (film), never zero.
    wgt = 0.25 + 0.75 * np.clip(4 * y * (1 - y), 0, 1) ** 0.8
    amp = p["grain_amp"] * k * wgt
    out = a + (field() * amp)[..., None]
    ca = p["grain_chroma"]
    if ca > 0:
        chroma = np.stack([field(), field(), field()], -1)
        chroma -= luma(chroma)[..., None]  # colour only: no change in luma()
        out = out + chroma * (amp * ca)[..., None]
    return out


def sharp_mask(h, w, boxes, cv2):
    m = np.zeros((h, w), np.float32)
    for x0, y0, x1, y1 in boxes:
        m[round(y0 * h):round(y1 * h), round(x0 * w):round(x1 * w)] = 1
    if boxes:
        m = cv2.GaussianBlur(m, (0, 0), 3)
    return m


def hex_rgb(s):
    h = s.strip().lstrip("#")
    if len(h) != 6 or any(c not in "0123456789abcdefABCDEF" for c in h):
        sys.exit(f"--keep needs a colour as RRGGBB, not {s!r}")
    return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))


def keep_mask(a, colours):
    """1 where a pixel is near one of the colours (kept exact by tone and halation), 0 far from all of them."""
    m = np.zeros(a.shape[:2], np.float32)
    for c in colours:
        d = np.sqrt(((a - np.asarray(c, np.float32)) ** 2).sum(-1))
        m = np.maximum(m, np.clip((KEEP_FAR - d) / (KEEP_FAR - KEEP_NEAR), 0, 1))
    return m[..., None]


def finish(img, strength=1.0, skip=(), sharp_boxes=(), seed=None, params=None, keep=()):
    """The finished picture (PIL RGB) from a PIL picture. Pure function of its inputs and the seed.
    keep: RGB colours (0..1) that the tone and halation steps leave exact (a brand colour)."""
    cv2 = need_cv2()
    p = dict(DEFAULTS)
    p.update(params or {})
    check_params(p)
    a = np.asarray(img.convert("RGB"), dtype=np.float32) / 255
    h, w = a.shape[:2]
    scale = w / REF_WIDTH
    k = float(strength)
    sharp = sharp_mask(h, w, list(sharp_boxes), cv2)
    rng = np.random.default_rng(seed)
    kept = keep_mask(a, keep) if keep else None
    if "tone" not in skip:
        a = tone(a, p, k) if kept is None else a * kept + tone(a, p, k) * (1 - kept)
    if "soften" not in skip:
        a = soften(a, p, k, scale, sharp, cv2)
    if "halation" not in skip:
        a = halation(a, p, k, scale, cv2) if kept is None else a * kept + halation(a, p, k, scale, cv2) * (1 - kept)
    if "lens" not in skip:
        a = lens(a, p, k, scale, sharp, cv2)
    if "grain" not in skip:
        a = grain(a, p, k, scale, rng, cv2)
    return Image.fromarray((np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8))


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--in", dest="src", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--strength", type=float, default=1.0, help="0 = no change, 1 = the tuned look (at most 2)")
    ap.add_argument("--sharp", action="append", default=[], help="x0,y0,x1,y1 (fractions): keep crisp, e.g. the logo; repeat")
    ap.add_argument("--seed", type=int, default=None, help="the same grain on each run")
    ap.add_argument("--keep", action="append", default=[], help="RRGGBB: keep this brand colour exact in tone and halation; repeat")
    ap.add_argument("--quality", type=int, default=95, help="JPEG quality of the output")
    for s in STEPS:
        ap.add_argument(f"--no-{s}", action="store_true", help=f"skip the {s} step")
    for name, val in DEFAULTS.items():
        ap.add_argument(f"--{name.replace('_', '-')}", type=float, default=None, help=f"tuning (default {val})")
    a = ap.parse_args(argv)
    if not 0 <= a.strength <= 2:
        sys.exit("--strength must be from 0 to 2")
    if not os.path.isfile(a.src):
        sys.exit(f"no picture at {a.src}")
    try:
        img = Image.open(a.src, formats=FORMATS)
        img.load()
    except Exception as e:  # noqa: BLE001  (any decoder error is a bad input)
        sys.exit(f"cannot read {a.src} as JPEG, PNG or WebP: {e}")
    boxes = [box_fracs(b) for b in a.sharp]
    keep = [hex_rgb(c) for c in a.keep]
    skip = {s for s in STEPS if getattr(a, f"no_{s}")}
    params = {n: getattr(a, n) for n in DEFAULTS if getattr(a, n) is not None}
    out = finish(img, a.strength, skip, boxes, a.seed, params, keep)
    try:
        if a.out.lower().endswith((".jpg", ".jpeg")):
            out.save(a.out, quality=a.quality, subsampling=0)
        else:
            out.save(a.out)
    except Exception as e:  # noqa: BLE001
        sys.exit(f"cannot write {a.out}: {e}")
    print(f"photo_finish: {img.size[0]}x{img.size[1]} strength {a.strength} steps {','.join(s for s in STEPS if s not in skip)}"
          f"{' sharp ' + str(len(boxes)) if boxes else ''}{' keep ' + ','.join(a.keep) if keep else ''} -> {a.out}")


if __name__ == "__main__":
    main()
