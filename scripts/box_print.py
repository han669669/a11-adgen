#!/usr/bin/env python3
"""Box print: rebuild the printed words on a boxed product (a cake box, a carton) from the real packshot, so they are crisp and sit at the real angle.

Why: a model repaints small print on a box. The words smear, and their angle and direction drift, so the ad looks "pasted" and fake
(Cat & the Fiddle W47: "ASIAN-INSPIRED CHEESECAKES" smeared on all 3 ads; the owner: look at how "artisanally conceived" is printed, its direction and
angle, and apply that). This script reads the ink from the real packshot, moves it onto the render with the same perspective, removes the smeared
print and lays the crisp ink back. Product, light and shadow are not touched.

Needs Python 3 with Pillow, numpy and OpenCV (opencv-python-headless). Runs in the session or on the owner's machine, not in the Worker.

  python3 scripts/box_print.py --config box_print.cat-and-the-fiddle.json --render final.jpg --out final-print.jpg [--debug mask.jpg]

--render must show the packshot's printed face (same product, a similar angle: SIFT matches the two). Run it on the composed picture of a final, never on a draft. Then take the result into the pack with PUT /admin/repair/<uuid>.jpg and final_attach (creative-playbook.md 7.5).
Check the result at full size next to the packshot (creative-playbook.md 7.5).

The config is one JSON file per product (keep it next to the brand's kit notes):

  packshot   path to the real packshot (the photo of the box). A relative path (here and in font) is read from the config file's folder
  face       x0,y0,x1,y1 of the printed face in the packshot (feature matching looks only there)
  font       path to a variable TTF, only for a block that is re-set in type (a font file is not stored in this repo)
  wght       the font's weight axis value
  blocks     a list of print blocks, each with:
    box      x0,y0,x1,y1 of the block in the packshot (pixels)
    thr      [lo, hi, blur]: the ink threshold. Default [0.40, 0.60, 0.6]. Condensed caps need a tighter cut: [0.50, 0.66, 0.42]
    xmin     (optional) ignore ink left of this packshot x (the box's own edge line)
    band     [[x,y],[x,y],half_width]: the centre line of a line of text, so a box edge under it is not read as ink.
             Optional, but required when the block has typeset
    typeset  (optional) {"text": "...", "lean": degrees}: re-set the block in type, on the baseline measured from the photo's ink.
             Use it when the packshot is too small to show the real letters. "lean" is the stem lean of the print in the photo
             (top to the right, in degrees; measured on a real line of the same box).
"""
import argparse
import json
import os
import sys

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

K = 4  # working scale: pixels per packshot pixel
DEFAULT_THR = (0.40, 0.60, 0.6)


def load_font(path, size, wght):
    try:
        f = ImageFont.truetype(path, size)
    except OSError:
        sys.exit(f"Cannot read the font: {path}")
    try:
        f.set_variation_by_axes([wght])
    except OSError:  # a static font has no axes
        pass
    return f


class Box:
    def __init__(self, cfg):
        self.pack = cv2.imread(cfg["packshot"])
        if self.pack is None:
            sys.exit(f"Cannot read the packshot: {cfg['packshot']}")
        self.face = cfg["face"]
        self.font = cfg.get("font")
        self.wght = cfg.get("wght", 400)
        self.blocks = cfg["blocks"]
        for i, b in enumerate(self.blocks):
            if "typeset" in b and "band" not in b:
                sys.exit(f"Block {i} has typeset but no band. A typeset block needs band.")

    def register(self, F):
        """Homography from the packshot to the render, from SIFT matches on the printed face only."""
        g1 = cv2.cvtColor(self.pack, cv2.COLOR_BGR2GRAY)
        g2 = cv2.cvtColor(F, cv2.COLOR_BGR2GRAY)
        x0, y0, x1, y1 = self.face
        m = np.zeros_like(g1)
        m[y0:y1, x0:x1] = 255
        sift = cv2.SIFT_create(nfeatures=4000)
        k1, d1 = sift.detectAndCompute(g1, m)
        k2, d2 = sift.detectAndCompute(g2, None)
        if d1 is None or d2 is None:
            sys.exit("No image features found in the packshot face or in the render. Check the face box and the render.")
        pairs = cv2.BFMatcher(cv2.NORM_L2).knnMatch(d1, d2, k=2)
        good = [p[0] for p in pairs if len(p) == 2 and p[0].distance < 0.8 * p[1].distance]
        if len(good) < 8:
            sys.exit(f"Only {len(good)} feature matches between the packshot and the render. The render must show the printed face.")
        src = np.float32([k1[a.queryIdx].pt for a in good])
        dst = np.float32([k2[a.trainIdx].pt for a in good])
        H, inl = cv2.findHomography(src, dst, cv2.RANSAC, 6.0)
        n_in = 0 if inl is None else int(inl.sum())
        if H is None or not np.isfinite(H).all() or n_in < max(8, len(good) // 3):
            sys.exit(f"Could not fit the packshot to the render: {n_in} inliers of {len(good)} matches. The render must show the printed face at a similar angle.")
        print("matches", len(good), "inliers", n_in)
        return H

    def ink_alpha(self, i, lo=None, hi=None, raw=False):
        """Ink coverage (0..1) of print block i, from the packshot, at K px per packshot px. Returns (alpha, (ox, oy))."""
        b = self.blocks[i]
        x0, y0, x1, y1 = b["box"]
        tlo, thi, tbl = b.get("thr", DEFAULT_THR)
        lo = tlo if lo is None else lo
        hi = thi if hi is None else hi
        ph, pw = self.pack.shape[:2]
        cx0, cy0 = max(x0 - 12, 0), max(y0 - 12, 0)  # the crop stays inside the packshot; (cx0, cy0) is its origin
        g = cv2.cvtColor(self.pack, cv2.COLOR_BGR2GRAY)[cy0:min(y1 + 12, ph), cx0:min(x1 + 12, pw)].astype(np.float32)
        g = cv2.resize(g, None, fx=K, fy=K, interpolation=cv2.INTER_CUBIC)
        bg = cv2.morphologyEx(g, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9 * K + 1, 9 * K + 1)))
        bg = cv2.GaussianBlur(bg, (0, 0), 6 * K)
        d0 = np.clip(bg - g, 0, None)
        m = np.ones(g.shape, np.float32)
        if "band" in b:
            (ax, ay), (bx, by), hw = b["band"]
            m = np.zeros(g.shape, np.uint8)
            p0 = (int((ax - cx0) * K), int((ay - cy0) * K))
            p1 = (int((bx - cx0) * K), int((by - cy0) * K))
            cv2.line(m, p0, p1, 255, int(2 * hw * K))
            m = cv2.GaussianBlur(m.astype(np.float32) / 255, (0, 0), 1.2 * K)
        if "xmin" in b:
            m[:, :int((b["xmin"] - cx0) * K)] = 0
        d0 = d0 * m
        ref = np.percentile(d0[m > 0.5], 99.5)
        loc = cv2.dilate(d0, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (4 * K + 1, 4 * K + 1)))  # strongest ink within 4 px: each stroke is judged against its neighbours
        loc = cv2.GaussianBlur(loc, (0, 0), 2 * K)
        d = np.clip(d0 / np.maximum(loc, 0.5 * ref), 0, 1)
        d = cv2.GaussianBlur(d, (0, 0), tbl * K)
        a = np.clip((d - lo) / (hi - lo), 0, 1)
        a = a * a * (3 - 2 * a)
        if "typeset" in b and not raw:
            return self.typeset(i)
        return a * m, (cx0, cy0)

    def typeset(self, i):
        """Block i re-set in type, on the baseline measured from the photo's own ink."""
        b = self.blocks[i]
        text, lean = b["typeset"]["text"], b["typeset"]["lean"]
        if not self.font:
            sys.exit("A typeset block needs a font in the config.")
        (ax, ay), (bx, by), hw = b["band"]
        a0, (ox, oy) = self.ink_alpha(i, 0.25, 0.5, raw=True)
        ys, xs = np.nonzero(a0 > 0.5)
        px = xs / K + ox
        py = ys / K + oy
        ang = np.arctan2(by - ay, bx - ax)
        e1 = np.array([np.cos(ang), np.sin(ang)])
        e2 = np.array([-np.sin(ang), np.cos(ang)])
        u = (px - ax) * e1[0] + (py - ay) * e1[1]
        v = (px - ax) * e2[0] + (py - ay) * e2[1]
        umin, umax = np.percentile(u, 0.5), np.percentile(u, 99.5)
        vlo, vhi = np.percentile(v, 2), np.percentile(v, 98)
        L = umax - umin
        cap = (vhi - vlo) * 1.03  # the 2..98 percentiles of a soft stroke read a little short
        vc = (vhi + vlo) / 2
        f = load_font(self.font, 100, self.wght)
        cb = f.getbbox("H")
        capf = cb[3] - cb[1]
        size = 100 * cap / capf * K * 4  # font size so the capital height equals the measured one
        f = load_font(self.font, int(round(size)), self.wght)
        ws = [f.getlength(c) for c in text]
        trk = 0.62 * K * 4  # a little air between letters, like the print
        nat = sum(ws) + trk * (len(text) - 1)
        Hh = int(cap * K * 4 * 2.2)
        im = Image.new("L", (int(nat) + 8, Hh), 0)
        dr = ImageDraw.Draw(im)
        x = 4
        cb = f.getbbox("H")
        ytop = (Hh - (cb[3] - cb[1])) // 2 - cb[1]
        for c, w in zip(text, ws):
            dr.text((x, ytop), c, font=f, fill=255)
            x += w + trk
        im = im.resize((int(L * K * 4) + 8, Hh), Image.LANCZOS)  # squeeze to the measured length: a box font is often narrower than the one in hand
        t = np.asarray(im, np.float32) / 255
        t = cv2.resize(t, None, fx=1 / 4, fy=1 / 4, interpolation=cv2.INTER_AREA)  # now K px per packshot px
        th, _ = t.shape
        org = np.array([ax, ay]) + e1 * umin + e2 * vc
        ph = np.radians(lean)
        E2 = np.array([-np.sin(ph), np.cos(ph)])
        E2 = E2 / (E2 @ e2)  # stems lean by `lean` degrees (the print plane is in perspective), cap height kept
        A = np.stack([e1, E2], axis=1)
        M2 = np.zeros((2, 3))
        M2[:, 0] = A[:, 0]
        M2[:, 1] = A[:, 1]
        M2[:, 2] = (org - np.array([ox, oy])) * K - (A[:, 0] * 1 + A[:, 1] * (th / 2))
        out = cv2.warpAffine(t, M2.astype(np.float32), (a0.shape[1], a0.shape[0]), flags=cv2.INTER_LINEAR)
        print("typeset: length", round(L, 1), "cap", round(cap, 1), "font px", int(round(size / (K * 4))))
        out = cv2.GaussianBlur(out, (0, 0), 0.30 * K)  # the real print is a little soft at this size
        return np.clip(out * 0.86, 0, 1), (ox, oy)


def darkness(g, close=41, thr_blur=12):
    bg = cv2.GaussianBlur(cv2.morphologyEx(g, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (close, close))), (0, 0), thr_blur)
    return np.clip(bg - g, 0, 255), bg


def refine(H, box, gF, pg, pad=40):
    """Local affine correction of H for one print block: ECC between the warped photo's print and the render's print."""
    quad = np.array([[box[0], box[1]], [box[2], box[1]], [box[2], box[3]], [box[0], box[3]]], np.float32).reshape(-1, 1, 2)
    q = cv2.perspectiveTransform(quad, H).reshape(-1, 2)
    x0, y0 = np.floor(q.min(0)).astype(int) - pad
    x1, y1 = np.ceil(q.max(0)).astype(int) + pad
    h, w = gF.shape
    x0, y0 = max(x0, 0), max(y0, 0)
    x1, y1 = min(x1, w), min(y1, h)
    Wp = cv2.warpPerspective(pg, H, (w, h), flags=cv2.INTER_CUBIC)
    dw, _ = darkness(Wp[y0:y1, x0:x1])
    df, _ = darkness(gF[y0:y1, x0:x1])
    dw = cv2.GaussianBlur(dw, (0, 0), 1.5)
    df = cv2.GaussianBlur(df, (0, 0), 1.5)
    warp = np.eye(2, 3, dtype=np.float32)
    try:
        cc, warp = cv2.findTransformECC(dw.astype(np.float32), df.astype(np.float32), warp, cv2.MOTION_AFFINE, (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 200, 1e-6), None, 5)
    except cv2.error as e:
        print("ecc failed", e)
        cc = 0
    A3 = np.vstack([warp, [0, 0, 1]]).astype(np.float64)
    T0 = np.array([[1, 0, x0], [0, 1, y0], [0, 0, 1.0]])
    corr = T0 @ A3 @ np.linalg.inv(T0)
    print("block", list(box), "ecc", round(float(cc), 3), "shift", warp[:, 2].round(1).tolist())
    return corr @ H


def run(cfg, src, dst, debug=None):
    bx = Box(cfg)
    F = cv2.imread(src)
    if F is None:
        sys.exit(f"Cannot read the render: {src}")
    H0 = bx.register(F)
    h, w = F.shape[:2]
    S2 = np.diag([2, 2, 1.0])
    Sk = np.diag([1 / K, 1 / K, 1.0])
    gF = cv2.cvtColor(F, cv2.COLOR_BGR2GRAY).astype(np.float32)
    pg = cv2.cvtColor(bx.pack, cv2.COLOR_BGR2GRAY).astype(np.float32)
    amap = np.zeros((h, w), np.float32)
    for i, b in enumerate(bx.blocks):
        H = refine(H0, b["box"], gF, pg)
        a, (ox, oy) = bx.ink_alpha(i)
        T = np.array([[1, 0, ox], [0, 1, oy], [0, 0, 1.0]])
        a2 = cv2.warpPerspective(a, S2 @ H @ T @ Sk, (w * 2, h * 2), flags=cv2.INTER_LINEAR)
        amap = np.maximum(amap, cv2.resize(a2, (w, h), interpolation=cv2.INTER_AREA))
    dF, _ = darkness(gF)
    near = cv2.dilate((amap > 0.02).astype(np.uint8) * 255, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (25, 25)))
    dark = cv2.bitwise_and(((dF > 14).astype(np.uint8) * 255), near)
    kill = cv2.dilate(np.maximum(dark, (amap > 0.02).astype(np.uint8) * 255), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)))
    clean = cv2.inpaint(F, kill, 7, cv2.INPAINT_TELEA).astype(np.float32)
    if not (dark > 0).any():
        sys.exit("No print found on the render near the registered blocks. Check the config boxes and the render.")
    # ink colour: the render's own darkest print pixels (lit like the box), not the photo's washed-out ink
    sel = (dark > 0) & (gF < np.percentile(gF[dark > 0], 12))
    inkc = np.median(F[sel], axis=0).astype(np.float32)
    A = cv2.GaussianBlur(amap, (0, 0), 0.45)[..., None] * 0.97
    res = np.clip(clean * (1 - A) + inkc * A, 0, 255).astype(np.uint8)
    if not cv2.imwrite(dst, res, [cv2.IMWRITE_JPEG_QUALITY, 95]):
        sys.exit(f"Cannot write the output: {dst}")
    if debug:
        cv2.imwrite(debug, np.hstack([cv2.cvtColor(near, cv2.COLOR_GRAY2BGR), cv2.cvtColor(kill, cv2.COLOR_GRAY2BGR)]))
    print(dst, "ink BGR", inkc.round(1).tolist())


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--config", required=True)
    ap.add_argument("--render", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--debug")
    a = ap.parse_args()
    with open(a.config) as fh:
        cfg = json.load(fh)
    here = os.path.dirname(os.path.abspath(a.config))
    for k in ("packshot", "font"):  # relative paths in the config are read from the config's own folder
        if cfg.get(k):
            cfg[k] = os.path.join(here, cfg[k])
    run(cfg, a.render, a.out, a.debug)


if __name__ == "__main__":
    main()
