#!/usr/bin/env python3
"""Food grade: colour-transfer the food in a packshot toward a real close-up photo of the same food.

Why: the real packshot kernels are true but pale and flat; the real close-up photo of the same product shows the warm golden
colour that makes them look good to eat. A Lab mean/std transfer moves only the colour of the kernels (a mask keeps the label,
glass and backdrop), so the real texture and shape stay. A model repaint of the food drifted (round, glossy, spotted kernels).

Needs Python 3 with Pillow and numpy.

  python3 scripts/food_grade.py --src packshot.jpg --ref closeup.jpg --ref-box 200,300,820,760 \
      --region 350,165,682,283 --region 350,860,682,982 --out packshot-graded.jpg

--region: where food shows in --src (x0,y0,x1,y1), one per food area. --ref-box: a patch of the close-up that is all kernels (--ref-bg is the backdrop colour to leave out).
Use the graded packshot as the --packshot of product_lock.py. Defaults (the W46c v3 settings, the owner's pick): strength 0.8, no spread boost, no contrast boost, no clarity. Stronger settings (strength 1, spread 1.15, contrast 1.12, clarity 0.7) looked fake and plastic to the owner.
"""
import numpy as np
from PIL import Image

M = np.array([[0.4124564, 0.3575761, 0.1804375], [0.2126729, 0.7151522, 0.0721750], [0.0193339, 0.1191920, 0.9503041]])
WP = np.array([0.95047, 1.0, 1.08883])

def to_lab(rgb):
    c = rgb / 255.0
    lin = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    xyz = lin @ M.T / WP
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], axis=-1)

def to_rgb(lab):
    fy = (lab[..., 0] + 16) / 116
    fx = fy + lab[..., 1] / 500
    fz = fy - lab[..., 2] / 200
    f = np.stack([fx, fy, fz], axis=-1)
    xyz = np.where(f ** 3 > 0.008856, f ** 3, (f - 16 / 116) / 7.787) * WP
    lin = xyz @ np.linalg.inv(M).T
    c = np.where(lin <= 0.0031308, 12.92 * lin, 1.055 * np.clip(lin, 0, None) ** (1 / 2.4) - 0.055)
    return np.clip(c * 255, 0, 255)

def kernel_mask(rgb, bg, dist=70, sat_min=0.28):  # lower both for pale kernels (--sat-min, --dist)
    """Kernels: saturated pixels clearly away from the plain backdrop colour (white glare and glass are not saturated)."""
    mx, mn = rgb.max(axis=-1), rgb.min(axis=-1)
    sat = (mx - mn) / np.maximum(mx, 1)
    d = np.abs(rgb - bg).sum(axis=-1)
    return (sat > sat_min) & (d > dist) & (mx > 70)

def grade(src, regions, ref, ref_box, strength=0.8, sd_boost=1.0, contrast=1.0, clarity=0.0, ref_bg=(245, 230, 210), dist=70, sat_min=0.28):
    """src: PIL RGB. regions: list of (x0,y0,x1,y1) in src where food shows. ref/ref_box: the close-up and an all-kernel patch of it.
    sd_boost widens the colour spread (deeper caramel patches), contrast stretches lightness, clarity adds local detail back."""
    from PIL import ImageFilter
    a = np.asarray(src.convert("RGB")).astype(float)
    r = np.asarray(ref.convert("RGB")).astype(float)
    x0, y0, x1, y1 = ref_box
    rc = r[y0:y1, x0:x1]
    for name, v, lo in (("strength", strength, 0.0), ("sd_boost", sd_boost, 0.01), ("contrast", contrast, 0.01), ("clarity", clarity, 0.0)):
        if not np.isfinite(v) or v < lo:
            raise ValueError(f"{name} must be a finite number of at least {lo}, got {v}")
    if len(ref_bg) != 3 or not all(0 <= c <= 255 for c in ref_bg):
        raise ValueError(f"ref_bg must be three channels from 0 to 255, got {ref_bg}")
    strength = float(np.clip(strength, 0.0, 1.0))
    # ref_bg: the close-up's plain backdrop colour; pixels near it (and white glare) are not counted as kernels
    rl = to_lab(rc)[kernel_mask(rc, np.array(ref_bg, dtype=float), dist, sat_min)]
    if rl.size == 0:
        raise ValueError("--ref-box has no kernel pixels (all of it is near --ref-bg or white): pick a patch that is all kernels")
    t_mu, t_sd = rl.mean(axis=0), rl.std(axis=0)
    out = a.copy()
    s_mu = t_mu
    for (X0, Y0, X1, Y1) in regions:
        reg = a[Y0:Y1, X0:X1]
        bg = np.median(a[Y0:Y1, max(0, X0 - 30):X0 - 5].reshape(-1, 3), axis=0)
        m = kernel_mask(reg, bg, dist, sat_min)
        if not m.any():
            raise ValueError(f"no kernel pixels found in region {(X0, Y0, X1, Y1)}: check the box, or lower --sat-min and --dist for pale kernels")
        lab = to_lab(reg)
        s_mu, s_sd = lab[m].mean(axis=0), lab[m].std(axis=0)
        mapped = (lab - s_mu) / np.maximum(s_sd, 1e-3) * (t_sd * sd_boost) + t_mu
        mapped[..., 0] = t_mu[0] + (mapped[..., 0] - t_mu[0]) * contrast
        new = to_rgb(mapped)
        blur = np.asarray(Image.fromarray(new.clip(0, 255).astype("uint8")).filter(ImageFilter.GaussianBlur(5))).astype(float)
        new = new + (new - blur) * clarity
        wm = np.asarray(Image.fromarray((m * strength * 255).astype("uint8")).filter(ImageFilter.GaussianBlur(1.4))).astype(float) / 255
        out[Y0:Y1, X0:X1] = reg * (1 - wm[..., None]) + new * wm[..., None]
    return Image.fromarray(out.clip(0, 255).astype("uint8")), (s_mu, t_mu)


def main():
    import argparse
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--src", required=True)
    p.add_argument("--ref", required=True)
    p.add_argument("--ref-box", required=True)
    p.add_argument("--region", action="append", required=True)
    p.add_argument("--ref-bg", default="245,230,210", help="R,G,B of the close-up's plain backdrop (not counted as kernels)")
    p.add_argument("--sat-min", type=float, default=0.28, help="smallest saturation that counts as a kernel (lower for pale kernels)")
    p.add_argument("--dist", type=float, default=70, help="smallest colour distance from the backdrop that counts as a kernel (lower for pale kernels)")
    p.add_argument("--strength", type=float, default=0.8, help="0 to 1")
    p.add_argument("--sd-boost", type=float, default=1.0, help="widen the colour spread (more than 1 gave a plastic look)")
    p.add_argument("--contrast", type=float, default=1.0)
    p.add_argument("--clarity", type=float, default=0.0, help="local detail added back (more than 0 gave a gritty, fake look)")
    p.add_argument("--out", required=True)
    a = p.parse_args()
    box = lambda s: tuple(int(float(v)) for v in s.split(","))
    out, (s_mu, t_mu) = grade(Image.open(a.src), [box(r) for r in a.region], Image.open(a.ref), box(a.ref_box), a.strength, a.sd_boost, a.contrast, a.clarity, tuple(int(v) for v in a.ref_bg.split(",")), a.dist, a.sat_min)
    out.save(a.out, quality=95)
    print(f"{a.out}: Lab mean of the kernels {s_mu.round(1).tolist()} -> {t_mu.round(1).tolist()}")


if __name__ == "__main__":
    main()
