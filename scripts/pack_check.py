#!/usr/bin/env python3
"""Pack check: is the pack in a render as tall and wide as the real pack?

Why (owner, 19-11-2026, IRVINS engine 3 test): the pouch came out short and wide in every concept, and he saw it at
once: "the product packaging ... has to match the actual real life packaging in size, in all dimensions". The size
guide is the brand's own packshot (and the brand's own product photos), never an earlier render of ours.

The script finds the pack on a plain stage (a backdrop of one colour, as the engine 3 brand-colour stage) from one
point inside it, and gives its height over width. It does the same for the packshot's alpha. Rows narrower than half
the pack's widest row are left out at the top and the bottom, so a clip on the top and a thin shadow line at the base
do not count; the width is the median of the middle rows. A fold or a crop changes the height: say so, and judge the
print (a round badge) as well.

  python3 scripts/pack_check.py --render <picture> --at X,Y --bg RRGGBB --packshot <cut-out packshot or its alpha mask> [--tolerance 0.02]

--at is a point inside the pack, in pixels of the render. --bg is the stage colour (the kit's brand colour); its shadow
counts as stage too (on a grey, white or dark stage: any near-neutral pixel from its shadow up to it). It prints the two ratios and the difference, and exits with 1 when the difference is over the
tolerance (relative), so a draft check can use it. Needs Python 3 with Pillow, numpy and OpenCV (scripts/requirements.txt).
"""
import argparse
import colorsys
import sys

import cv2
import numpy as np
from PIL import Image


def hex_rgb(s):
    s = s.strip().lstrip("#")
    if len(s) != 6 or any(c not in "0123456789abcdefABCDEF" for c in s):
        sys.exit(f"--bg needs a colour as RRGGBB, not {s!r}")
    return tuple(int(s[i:i + 2], 16) for i in (0, 2, 4))


def stage_mask(rgb, bg):
    """True where the pixel is the stage colour or its shadow: the same hue, enough of its saturation."""
    h0, s0, _ = colorsys.rgb_to_hsv(*(c / 255 for c in bg))
    a = rgb.astype(np.float32) / 255
    mx, mn = a.max(2), a.min(2)
    s = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
    d = np.maximum(mx - mn, 1e-6)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    h = np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) / 6
    v0 = max(bg) / 255
    dh = np.abs(h - h0)
    dh = np.minimum(dh, 1 - dh)
    if s0 < 0.2:
        # A grey, white, black or near-neutral stage: any near-neutral pixel from its shadow up to it. A tinted stage
        # (beige) keeps its hue, so a muted pack of another hue is not taken as stage.
        tone = (s < max(0.15, s0 + 0.05)) & (mx >= 0.35 * v0) & (mx <= v0 + 0.08)
        return tone & ((s < 0.08) | (dh < 0.1)) if s0 >= 0.08 else tone
    if v0 < 0.3:
        # A dark coloured stage (deep red, navy): follow its hue, from its shadow up to it, with no brightness floor.
        return (dh < 0.045) & (s > 0.45 * s0) & (mx <= v0 + 0.08)
    # The floor is relative to the stage, so a deep shadow of a bright stage is still stage.
    return (dh < 0.045) & (s > 0.45 * s0) & (mx > 0.2 * v0)


def close_bands(mask):
    """Bridge thin bands of stage colour inside the pack (a yellow print line from edge to edge), so the pack stays one
    region: a vertical closing about 3% of the picture high. A gap that tall between the pack and the stage stays open.
    A thicker band still splits the pack: the printed pixel height then is too small, so check it against the picture."""
    k = max(3, int(round(mask.shape[0] * 0.03)) | 1)
    return cv2.morphologyEx(mask.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((k, 1), np.uint8)).astype(bool)


def region(mask, x, y):
    """The connected part of mask that holds (x, y), as a boolean array (4-neighbour fill)."""
    H, W = mask.shape
    if not (0 <= x < W and 0 <= y < H) or not mask[y, x]:
        sys.exit(f"--at {x},{y} is not inside the pack (it is on the stage, or outside the picture)")
    out = np.zeros_like(mask)
    stack = [(y, x)]
    while stack:
        cy, cx = stack.pop()
        if out[cy, cx] or not mask[cy, cx]:
            continue
        x0 = cx
        while x0 > 0 and mask[cy, x0 - 1] and not out[cy, x0 - 1]:
            x0 -= 1
        x1 = cx
        while x1 < W - 1 and mask[cy, x1 + 1] and not out[cy, x1 + 1]:
            x1 += 1
        out[cy, x0:x1 + 1] = True
        for ny in (cy - 1, cy + 1):
            if 0 <= ny < H:
                row = mask[ny, x0:x1 + 1] & ~out[ny, x0:x1 + 1]
                for i in np.flatnonzero(row):
                    stack.append((ny, x0 + int(i)))
    return out


def ratio(obj):
    """Height over width of a pack mask, without the narrow rows at its top and bottom (a clip, a shadow line)."""
    # The span of each row, not its pixel count: print in a colour near the stage (yellow lettering) leaves holes.
    any_ = obj.any(1)
    first = np.argmax(obj, 1)
    last = obj.shape[1] - 1 - np.argmax(obj[:, ::-1], 1)
    widths = np.where(any_, last - first + 1, 0)
    if widths.max() == 0:
        sys.exit("no pack found")
    rows = np.flatnonzero(widths >= 0.5 * widths.max())
    top, bot = int(rows[0]), int(rows[-1])
    h = bot - top + 1
    mid = widths[top + h // 4: bot - h // 4 + 1]
    w = float(np.median(mid if len(mid) else widths[rows]))
    return h / w, h, w


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--render", required=True)
    ap.add_argument("--at", required=True, help="X,Y: a point inside the pack, in render pixels")
    ap.add_argument("--bg", required=True, help="the stage colour as RRGGBB")
    ap.add_argument("--packshot", required=True, help="the brand's cut-out packshot, or its grey alpha mask")
    ap.add_argument("--sideways", action="store_true", help="the pack lies on its side (product_lock.py turn): turn the packshot too")
    ap.add_argument("--tolerance", type=float, default=0.02)
    a = ap.parse_args(argv)
    try:
        x, y = (int(v) for v in a.at.split(","))
    except ValueError:
        sys.exit("--at needs X,Y in whole pixels")
    rgb = np.asarray(Image.open(a.render).convert("RGB"))
    pack = region(close_bands(~stage_mask(rgb, hex_rgb(a.bg))), x, y)
    shot = Image.open(a.packshot)
    # A grey mask (as product_lock.py --alpha) is the alpha itself; any other file must carry its own transparency.
    alpha = np.asarray(shot if shot.mode == "L" else shot.convert("RGBA").getchannel("A"))
    if alpha.min() > 128:
        sys.exit("--packshot needs the cut-out packshot (transparent round the pack) or its grey alpha mask")
    mask = alpha > 128
    r, h, w = ratio(np.rot90(mask) if a.sideways else mask)
    q, qh, qw = ratio(pack)
    diff = q / r - 1
    ok = abs(diff) <= a.tolerance
    print(f"render H/W {q:.3f} ({qh} x {qw:.0f} px); packshot H/W {r:.3f}; difference {diff:+.1%}; {'PASS' if ok else 'FAIL'} at {a.tolerance:.0%}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
