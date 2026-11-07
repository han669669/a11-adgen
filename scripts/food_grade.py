#!/usr/bin/env python3
"""Food grade: colour-transfer the food in a packshot toward a real close-up photo of the same food.

Why: the real packshot kernels are true but pale and flat; the real close-up photo of the same product shows the warm golden
colour that makes them look good to eat. A Lab mean/std transfer moves only the colour of the kernels (a mask keeps the label,
glass and backdrop), so the real texture and shape stay. A model repaint of the food drifted (round, glossy, spotted kernels).

Needs Python 3 with Pillow and numpy.

  python3 scripts/food_grade.py --src packshot.jpg --ref closeup.jpg --ref-box 200,300,820,760 \
      --region 350,165,682,283 --region 350,860,682,982 --out packshot-graded.jpg

--region: where food shows in --src (x0,y0,x1,y1), one per food area. --ref-box: a patch of the close-up that is all kernels.
Use the graded packshot as the --packshot of product_lock.py. Default strength 0.8.
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

def kernel_mask(rgb, bg):
    """Kernels are the pixels clearly away from the plain backdrop colour and saturated enough."""
    mx, mn = rgb.max(axis=-1), rgb.min(axis=-1)
    sat = (mx - mn) / np.maximum(mx, 1)
    d = np.abs(rgb - bg).sum(axis=-1)
    return (sat > 0.28) & (d > 70) & (mx > 70)

def grade(src, regions, ref, ref_box, strength=0.8):
    """src: PIL RGB. regions: list of (x0,y0,x1,y1) in src where food shows. ref/ref_box: the close-up and its kernel area."""
    a = np.asarray(src.convert("RGB")).astype(float)
    r = np.asarray(ref.convert("RGB")).astype(float)
    x0, y0, x1, y1 = ref_box
    rc = r[y0:y1, x0:x1]
    rm = kernel_mask(rc, np.array([245, 230, 210.0]))
    rl = to_lab(rc)[rm]
    t_mu, t_sd = rl.mean(axis=0), rl.std(axis=0)
    out = a.copy()
    for (X0, Y0, X1, Y1) in regions:
        reg = a[Y0:Y1, X0:X1]
        bg = np.median(a[Y0:Y1, max(0, X0 - 30):X0 - 5].reshape(-1, 3), axis=0)
        m = kernel_mask(reg, bg)
        lab = to_lab(reg)
        s_mu, s_sd = lab[m].mean(axis=0), lab[m].std(axis=0)
        mapped = (lab - s_mu) / np.maximum(s_sd, 1e-3) * t_sd + t_mu
        new = to_rgb(mapped)
        w = (m.astype(float) * strength)[..., None]
        # soften the mask so kernel edges do not show a seam
        from PIL import ImageFilter
        wm = np.asarray(Image.fromarray((w[..., 0] * 255).astype("uint8")).filter(ImageFilter.GaussianBlur(1.2))).astype(float) / 255
        out[Y0:Y1, X0:X1] = reg * (1 - wm[..., None]) + new * wm[..., None]
    return Image.fromarray(out.clip(0, 255).astype("uint8")), (s_mu, t_mu)


def main():
    import argparse
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--src", required=True)
    p.add_argument("--ref", required=True)
    p.add_argument("--ref-box", required=True)
    p.add_argument("--region", action="append", required=True)
    p.add_argument("--strength", type=float, default=0.8)
    p.add_argument("--out", required=True)
    a = p.parse_args()
    box = lambda s: tuple(int(float(v)) for v in s.split(","))
    out, (s_mu, t_mu) = grade(Image.open(a.src), [box(r) for r in a.region], Image.open(a.ref), box(a.ref_box), a.strength)
    out.save(a.out, quality=95)
    print(f"{a.out}: Lab mean of the kernels {s_mu.round(1).tolist()} -> {t_mu.round(1).tolist()}")


if __name__ == "__main__":
    main()
