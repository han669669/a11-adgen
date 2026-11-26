#!/usr/bin/env python3
"""Label transfer: put the packshot's real label print on a front-on product in a render, and keep the render's light.

Why (owner, 26-11-2026, B/SKIN serum, engine 2): the image model redraws small print. On a low draft "The letters in
EFFORTLESS ESSENTIALS have inconsistent spacing and edges. The smaller 20% VIT-C POWER SERUM text looks reconstructed.
Some characters have ghosting and uneven strokes." He reads the label at full size. A paste of the packshot is not the
answer: it brings the packshot's own studio light into the scene (owner, 20-11-2026, D10). This script moves only the
ink: each label pixel becomes the render's own clean body colour at that place (its light, its shade, its grain) plus
the packshot's ink difference, scaled by the render's light. So the print is the brand's real print, and the light on
it is the scene's light.

The body is found by its label colour from one point inside it, in the render and in the packshot (as
scripts/shape_fix.py does; run that script first, so the shapes agree). The packshot's ink is aligned to the render's
ink (scale within 3%, a small shift), and the alignment score is printed. A score under --min-score stops the script (a badly redrawn print scores about 0.45, the B/SKIN mof final):
the print in the render does not match the packshot (a turned product, a wrong product, or a render with no print).
Only the label box changes: --inset gives its edges inside the body, as fractions of the body width (left, top, right,
bottom), so the curved sides of a round body keep the render's own pixels.

The print that moves is the packshot's dark ink and a band round it (so the light parts of a mark come too). A light
line away from the dark ink (a white net-weight line) moves only with --light-print: a sharp studio reflection on the
packshot looks the same to the code, so the default leaves both behind. Give --light-print only when the label has
separate light print and the packshot has no sharp glare on the label. The alignment always needs dark print: a label
with only white print stops here, and gets a local patch from the packshot instead.

  python3 scripts/label_transfer.py --in <render> --out <picture> --body RRGGBB --at X,Y \\
      --packshot <packshot> --pack-at X,Y [--inset 0.07,0.10,0.07,0.07] [--min-score 0.35] [--light-print]

Then run scripts/photo_finish.py and scripts/headline.py as usual. Needs Python 3 with Pillow, numpy and OpenCV
(scripts/requirements.txt).
"""
import argparse
import os
import sys

import cv2
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from shape_fix import body_region, hex_rgb, open_rgb, point  # noqa: E402  (the finish kit installs both in one folder)


def lum(x):
    return x[..., 0] * 0.299 + x[..., 1] * 0.587 + x[..., 2] * 0.114


def masked_blur(v, m, sigma):
    m = m.astype(np.float32)
    return cv2.GaussianBlur(v * m, (0, 0), sigma) / np.maximum(cv2.GaussianBlur(m, (0, 0), sigma), 1e-4)


def ink_mask(rgb, body, sigma):
    """Pixels clearly darker than the body around them: the print."""
    lo = lum(rgb)
    return body & (lo < 0.8 * masked_blur(lo, body, sigma))


def light_ink_mask(rgb, body, sigma):
    """Light print (a white or silver line): clearly lighter than the body around it, with sharp edges. A studio
    highlight is lighter too, but its edges are soft, so it is left out."""
    lo = lum(rgb)
    lighter = body & (lo > 1.12 * masked_blur(lo, body, sigma))
    edge = np.abs(lo - cv2.GaussianBlur(lo, (0, 0), 1.0)) > 10
    near_edge = cv2.dilate(edge.astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool)
    return lighter & near_edge


def transfer(render, pack, r, q, inset, min_score, light_print=False):
    H, W = render.shape[:2]
    pw, rw = q["w"], r["w"]
    pl, pr = q["cx"] - pw / 2, q["cx"] + pw / 2
    lx0, lx1 = pl + inset[0] * pw, pr - inset[2] * pw
    ly0, ly1 = q["top"] + inset[1] * pw, q["bot"] - inset[3] * pw
    if lx1 - lx0 < 10 or ly1 - ly0 < 10:
        sys.exit("--inset leaves no label box inside the body")
    pink = ink_mask(pack, q["mask"], max(pw / 25, 3))
    rink = ink_mask(render, r["mask"], max(rw / 20, 4))
    if not pink[int(ly0):int(ly1), int(lx0):int(lx1)].any():
        sys.exit("the packshot has no print inside the label box: check --pack-at and --inset")
    best = None
    step = max(1, int(round(rw / 200)))
    for sc in np.linspace(0.97, 1.03, 7):
        s = rw / pw * sc
        pk = cv2.resize(pink.astype(np.float32), None, fx=s, fy=s, interpolation=cv2.INTER_AREA)
        for dy in range(-7 * step, 7 * step + 1, step):
            for dx in range(-4 * step, 4 * step + 1, step):
                ox = int(round(r["cx"] - q["cx"] * s)) + dx
                oy = int(round(r["bot"] - q["bot"] * s)) + dy
                y0, y1, x0, x1 = int(oy + ly0 * s), int(oy + ly1 * s), int(ox + lx0 * s), int(ox + lx1 * s)
                if y0 < 0 or x0 < 0 or y1 > H or x1 > W:
                    continue
                a = pk[y0 - oy:y1 - oy, x0 - ox:x1 - ox]
                b = rink[y0:y1, x0:x1].astype(np.float32)
                if a.shape != b.shape:
                    continue
                score = float((a * b).sum() / np.sqrt((a * a).sum() * (b * b).sum() + 1e-6))
                if best is None or score > best[0]:
                    best = (score, s, ox, oy)
    if best is None:
        sys.exit("the label box does not fit inside the render: the product is too near the picture's edge")
    score, s, ox, oy = best
    print(f"alignment score {score:.3f} at scale {s * pw / rw:.3f} of the body width")
    if score < min_score:
        sys.exit(f"the print in the render does not match the packshot (score {score:.2f}, under --min-score {min_score}): is the product front-on, and is it this product?")
    if score < 0.55:
        print("LOW SCORE: the model redrew much of the print; check the new print's place on the body at full size")
    ps = cv2.resize(pack, None, fx=s, fy=s, interpolation=cv2.INTER_AREA)
    placed = np.zeros_like(render)
    y0, x0 = max(oy, 0), max(ox, 0)
    y1, x1 = min(oy + ps.shape[0], H), min(ox + ps.shape[1], W)
    placed[y0:y1, x0:x1] = ps[y0 - oy:y1 - oy, x0 - ox:x1 - ox]
    label = np.zeros((H, W), np.float32)
    label[int(oy + ly0 * s):int(oy + ly1 * s), int(ox + lx0 * s):int(ox + lx1 * s)] = 1
    label *= r["mask"]
    label = cv2.GaussianBlur(cv2.erode(label, np.ones((5, 5), np.uint8)), (0, 0), 3)
    lc = lum(placed)
    in_label = label > 0.01
    pclean = (lc > 0.8 * masked_blur(lc, in_label, max(rw / 30, 3))) & in_label
    # The render's clean body: away from its print and the print's soft halo (a smeared letter darkens its surround).
    halo = ink_mask(render, r["mask"], max(rw / 20, 4)) | (lum(render) < 0.92 * masked_blur(lum(render), r["mask"], max(rw / 20, 4)))
    k = max(5, int(round(rw / 40)) | 1)
    rclean = r["mask"] & ~cv2.dilate((halo & r["mask"]).astype(np.uint8), np.ones((k, k), np.uint8)).astype(bool)
    sigma = max(rw / 14, 4)
    cr = np.dstack([masked_blur(render[..., i], rclean, sigma) for i in range(3)])  # the render's clean body light
    cp = np.dstack([masked_blur(placed[..., i], pclean, sigma) for i in range(3)])  # the packshot's clean body light
    gain = (lum(cr) / np.maximum(lum(cp), 1))[..., None]
    # Only the packshot's print moves: its dark ink and a band of 1/20 of the body width round it, so the light parts of
    # a mark (the silver stripes and curls of the B/SKIN mark) come too, with the soft letter edges. A studio highlight on
    # the packshot's plain label is not print, so it stays behind. Sharp light ink away from the dark ink (a white line)
    # comes only with --light-print, because a sharp reflection looks the same (Devin Review, PR 156).
    k = max(3, int(round(rw / 10)) | 1)
    sig = max(rw / 30, 3)
    printed = ink_mask(placed, in_label, sig)
    if light_print:
        printed |= light_ink_mask(placed, in_label, sig)
    pmark = cv2.dilate(printed.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)))
    pmark = cv2.GaussianBlur(pmark.astype(np.float32), (0, 0), max(rw / 120, 1))[..., None]
    new = np.clip(cr + (placed - cp) * gain * pmark, 0, 255)
    # The whole label box takes the new pixels, so no model-drawn letter is left behind (ghosting). Its fine grain comes
    # back in scripts/photo_finish.py.
    w = label[..., None]
    return render * (1 - w) + new * w, score


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--in", dest="src", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--body", required=True, help="the body's label colour, RRGGBB")
    p.add_argument("--at", required=True, help="X,Y: a point on the plain label colour in the render")
    p.add_argument("--packshot", required=True, help="the brand's packshot, front-on")
    p.add_argument("--pack-at", required=True, help="X,Y: a point on the plain label colour in the packshot")
    p.add_argument("--inset", default="0.07,0.10,0.07,0.07", help="the label box inside the body: left,top,right,bottom as fractions of the body width")
    p.add_argument("--min-score", type=float, default=0.35, help="the lowest ink alignment score that is taken as a match")
    p.add_argument("--light-print", action="store_true", help="also move sharp light print away from the dark ink (a white line); only when the packshot has no sharp glare on the label")
    a = p.parse_args(argv)
    try:
        inset = [float(v) for v in a.inset.split(",")]
    except ValueError:
        inset = []
    if len(inset) != 4 or not all(0 <= v < 0.45 for v in inset):
        sys.exit(f"--inset needs four fractions from 0 to under 0.45 (left,top,right,bottom), not {a.inset!r}")
    if not 0 < a.min_score < 1:
        sys.exit("--min-score must be more than 0 and less than 1")
    colour = hex_rgb(a.body)
    render, pack = open_rgb(a.src), open_rgb(a.packshot)
    r = body_region(render, colour, point(a.at, "--at"))
    q = body_region(pack, colour, point(a.pack_at, "--pack-at"), "--pack-at")
    out, _ = transfer(render, pack, r, q, inset, a.min_score, a.light_print)
    Image.fromarray(np.clip(out + 0.5, 0, 255).astype(np.uint8)).save(a.out, quality=95)
    print(f"{a.out}: the packshot's print set in the render's light")


if __name__ == "__main__":
    main()
