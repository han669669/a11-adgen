#!/usr/bin/env python3
"""Product lock: put the REAL product pixels into a layout, so its shape is right by construction.

Why: a model redraws a product from a photo and drifts (W46c: the jar came out 9% too squat, the cap too short).
A model keeps what is already in its input image. So we place the real product, cut from the packshot, at the exact
proportions, and the model only builds the scene around it (creative-playbook.md section 7.4).

Needs Python 3 with Pillow and numpy. Runs on the owner's machine or in the session, not in the Worker.

  skeleton  A blank canvas with N real products placed on it. Use it as the ONLY reference of a draft.
            Each draft gets its own placement, so the 3 drafts of an idea differ in layout, scale and crop.
  cutout    Make a silhouette mask for a product that is not a rounded box (a cake on its box, on a dark or white backdrop).
            Pass it as --alpha to skeleton and swap.
  swap      Replace the product in an existing draft or final with the real one (repair of a picked draft).
            --lower-only keeps the scene above the label: for an open, almost empty jar (the packshot cannot show that
            state, so only the label and the base are real pixels).

--box is the product's silhouette in the packshot: x0,y0,x1,y1 in pixels (read it from a grid overlay of the packshot).
"""
import argparse
import sys

import numpy as np
from PIL import Image, ImageDraw

PAD = 4  # px of packshot kept around the silhouette, so the edge is not cut


def ints(s, n):
    v = [int(float(x)) for x in s.split(",")]
    if len(v) != n:
        sys.exit(f"expected {n} numbers: {s}")
    return v


def rgb(s):
    if s.startswith("#"):
        return tuple(int(s[i:i + 2], 16) for i in (1, 3, 5))
    return tuple(ints(s, 3))


def alpha(size, scale, square_top=False):
    """Rounded-rectangle mask, drawn at 4x and shrunk for a soft edge."""
    w, h = size
    m = Image.new("L", (w * 4, h * 4), 0)
    d = ImageDraw.Draw(m)
    ins = round(PAD * scale * 4)
    d.rounded_rectangle((ins, 0 if square_top else ins, w * 4 - ins, h * 4 - ins), radius=round(34 * scale * 4), fill=255)
    if square_top:
        d.rectangle((ins, 0, w * 4 - ins, h * 2), fill=255)
    return m.resize(size, Image.LANCZOS)


def alpha_from_png(path, box, size):
    """The product's own silhouette from a mask file (made by `cutout`), cropped like the piece and resized to it."""
    m = Image.open(path).convert("L")
    return m.crop(box).resize(size, Image.LANCZOS)


def cutout(a):
    """Cut a product out of a packshot with a plain backdrop (dark and/or white), for products that are not a rounded box
    (a cake on its box). A dark pixel (max channel below --dark-max) or a light unsaturated pixel (saturation below --light-sat and
    brightness above --light-min) that is joined to the picture's border is backdrop; everything else is the product.
    The mask is opened (--open px) and eroded by 1 px (no specks, thin lines or fringe), reduced to its largest piece, and softened a little."""
    from PIL import ImageFilter
    im = Image.open(a.packshot).convert("RGB")
    arr = np.asarray(im).astype(int)
    H, W = arr.shape[:2]
    mx, mn = arr.max(axis=2), arr.min(axis=2)
    sat = (mx - mn) / np.maximum(mx, 1)
    border = [(x, y) for x in range(W) for y in (0, H - 1)] + [(x, y) for y in range(H) for x in (0, W - 1)]

    def backdrop(cls):
        b = Image.fromarray((cls * 255).astype("uint8"), "L")
        out = np.zeros((H, W), bool)
        for s in border[:: max(1, a.seed_step)]:
            if b.getpixel(s) == 255 and not out[s[1], s[0]]:
                t = b.copy()
                ImageDraw.floodfill(t, s, 128)
                out |= np.asarray(t) == 128
        return out

    bg = backdrop(mx < a.dark_max) | backdrop((sat < a.light_sat) & (mx > a.light_min))
    m = Image.fromarray(((~bg) * 255).astype("uint8"), "L").filter(ImageFilter.MinFilter(a.open)).filter(ImageFilter.MaxFilter(a.open)).filter(ImageFilter.MinFilter(3))
    fg = np.asarray(m) > 0
    lab = Image.fromarray((fg * 255).astype("uint8"), "L")
    seen = np.zeros((H, W), bool)
    best = None
    ys, xs = np.where(fg)
    for y, x in zip(ys[::5], xs[::5]):
        if seen[y, x]:
            continue
        t = lab.copy()
        ImageDraw.floodfill(t, (int(x), int(y)), 128)
        c = np.asarray(t) == 128
        seen |= c
        if best is None or c.sum() > best.sum():
            best = c
    if best is None:
        sys.exit("no product found: every pixel counts as backdrop. Lower --dark-max or --light-sat.")
    Image.fromarray((best * 255).astype("uint8"), "L").filter(ImageFilter.GaussianBlur(0.9)).save(a.out)
    ys, xs = np.where(best)
    print(f"{a.out}: product box x {xs.min()},{xs.max()} y {ys.min()},{ys.max()} ({int(best.sum())} px of {W * H}). Use --box {xs.min()},{ys.min()},{xs.max()},{ys.max()} --alpha {a.out}")


def cut(pack, box, band_top=None):
    x0, y0, x1, y1 = box
    top = band_top if band_top is not None else y0
    return pack.crop((x0 - PAD, top - PAD if band_top is None else top, x1 + PAD, y1 + PAD))


def skeleton(a):
    pack = Image.open(a.packshot).convert("RGB")
    W, H = ints(a.size, 2)
    x0, y0, x1, y1 = ints(a.box, 4)
    piece = cut(pack, (x0, y0, x1, y1))
    jar_h = round(H * a.jar_height)
    scale = jar_h / (y1 - y0 + 2 * PAD)
    piece = piece.resize((round(piece.width * scale), round(piece.height * scale)), Image.LANCZOS)
    mask = alpha_from_png(a.alpha, (x0 - PAD, y0 - PAD, x1 + PAD, y1 + PAD), piece.size) if a.alpha else alpha(piece.size, scale)
    canvas = Image.new("RGB", (W, H), rgb(a.bg))
    pitch = piece.width * (1 + a.gap)
    total = pitch * (a.count - 1) + piece.width
    left = a.cx * W - total / 2
    top = round(a.base * H - piece.height + PAD * scale)
    for i in range(a.count):
        canvas.paste(piece, (round(left + i * pitch), top), mask)
    canvas.save(a.out, quality=95)
    print(f"{a.out}: product {piece.width}x{piece.height}px, H/W {(y1 - y0) / (x1 - x0):.3f}")


def swap(a):
    pack = Image.open(a.packshot).convert("RGB")
    scene = Image.open(a.scene).convert("RGB")
    x0, y0, x1, y1 = ints(a.box, 4)
    ox0, ox1, otop, obase = ints(a.old, 4)  # the old product in the scene: x0,x1,top,base (one product per call)
    arr = np.asarray(scene).astype(float)
    H, W = arr.shape[:2]
    if not (0 <= ox0 < ox1 <= W and 0 <= otop < obase <= H):
        sys.exit(f"--old {a.old} is outside the scene ({W}x{H}) or not x0<x1, top<base")
    cx = a.cx if a.cx is not None else (ox0 + ox1) / 2
    if a.scale is not None and a.lower_only:
        sys.exit("--scale cannot be combined with --lower-only")
    if a.scale is not None:  # same scale for pieces that must keep their real size next to each other (a jar and its cap)
        if a.scale <= 0:
            sys.exit("--scale must be greater than zero")
        scale = a.scale
        piece = pack.crop((x0 - PAD, y0 - PAD, x1 + PAD, y1 + PAD))
    elif a.lower_only:
        if a.band_top is None:
            sys.exit("--lower-only needs --band-top (y of the label's top band in the packshot)")
        scale = (ox1 - ox0) / (x1 - x0 + 2 * PAD)
        piece = pack.crop((x0 - PAD, a.band_top, x1 + PAD, y1 + PAD))
    else:
        scale = (obase - otop) / (y1 - y0 + 2 * PAD)
        piece = pack.crop((x0 - PAD, y0 - PAD, x1 + PAD, y1 + PAD))
    piece = piece.resize((round(piece.width * scale), round(piece.height * scale)), Image.LANCZOS)
    if a.alpha and a.lower_only:
        sys.exit("--alpha cannot be combined with --lower-only")
    mask = alpha_from_png(a.alpha, (x0 - PAD, y0 - PAD, x1 + PAD, y1 + PAD), piece.size) if a.alpha else alpha(piece.size, scale, square_top=a.lower_only)
    ytop = obase - piece.height + round(PAD * scale)
    # Paint the old product's area with the backdrop (a blend of the columns just outside it), then paste the real one.
    pad, probe = 8, 14
    # lower-only keeps the scene above the pasted piece (the open neck and rim stay); a full swap clears the old product.
    fy0 = max(0, (ytop - 4) if a.lower_only else (min(otop, ytop) - 6))
    fy1 = min(H, obase + 8)
    fx0, fx1 = max(0, ox0 - pad), min(W, ox1 + pad)  # clip to the picture: a product at an edge must not wrap or crash
    lcols = arr[:, max(0, fx0 - probe):fx0]
    rcols = arr[:, fx1:fx1 + probe]
    if lcols.shape[1] == 0 and rcols.shape[1] == 0:
        sys.exit("the old product spans the whole width: there is no backdrop beside it to blend from")
    L = (lcols if lcols.shape[1] else rcols).mean(axis=1)  # an edge-touching product uses the one side that exists
    R = (rcols if rcols.shape[1] else lcols).mean(axis=1)
    for x in range(fx0, fx1):
        t = (x - fx0) / max(1, fx1 - fx0)
        arr[fy0:fy1, x] = L[fy0:fy1] * (1 - t) + R[fy0:fy1] * t
    out = Image.fromarray(arr.clip(0, 255).astype("uint8"))
    out.paste(piece, (round(cx - piece.width / 2), ytop), mask)
    out.save(a.out, quality=95)
    print(f"{a.out}: pasted {piece.width}x{piece.height}px at x={round(cx - piece.width / 2)} y={ytop}")


def pad45(a):
    """Pad a square packshot to 4:5 (the model edits 4:5 only) by repeating its edge rows, so its pixels keep their x and shift down."""
    im = np.asarray(Image.open(a.packshot).convert("RGB"))
    h, w = im.shape[:2]
    extra = round(w * 5 / 4) - h
    if extra < 0 or extra % 2:
        sys.exit(f"packshot {w}x{h}: cannot pad to 4:5 with equal rows")
    Image.fromarray(np.pad(im, ((extra // 2, extra // 2), (0, 0), (0, 0)), mode="edge")).save(a.out, quality=95)
    print(f"{a.out}: padded {extra // 2} px at the top and bottom, size {w}x{h + extra}; packshot y + {extra // 2} = padded y")


def widen_neck(img, rim, neck_end, shoulder_end, factor, cx):
    """The model draws the open neck narrower than the body (bottle-like). The real jar is straight-sided under a cap that is almost
    as wide as the body, so widen the neck rows by `factor` about the jar's centre, easing back to 1.0 by shoulder_end."""
    out = img.copy()
    w = img.shape[1]
    xs = np.arange(w, dtype=float)
    for y in range(rim, shoulder_end + 1):
        f = factor if y <= neck_end else 1 + (factor - 1) * (shoulder_end - y) / max(1, shoulder_end - neck_end)
        src = cx + (xs - cx) / f
        for c in range(3):
            out[y, :, c] = np.interp(src, xs, img[y, :, c])
    return out


def open_source(a):
    """Build the source for an OPEN product from a model edit of the padded packshot (cap removed, same framing).
    The model gives the open neck at the packshot's own camera angle. Everything from --real-from down is the real photo again
    (the cut hides inside the label's solid top band), and one strip of repeated threads is added so the neck reaches its true height."""
    pad = Image.open(a.padded).convert("RGB")
    edit = Image.open(a.edit).convert("RGB").resize(pad.size, Image.LANCZOS)
    E, P = np.asarray(edit).copy(), np.asarray(pad)
    E[a.real_from:] = P[a.real_from:]
    s0, s1 = ints(a.strip, 2)
    if not (0 <= s0 <= s1 < a.real_from < E.shape[0]):
        sys.exit(f"--strip {a.strip} and --real-from {a.real_from} must be in bounds and ordered: 0 <= strip start <= strip end < real-from < {E.shape[0]}")
    strip = E[s0:s1 + 1].copy()
    if a.repeat < 1:
        sys.exit("--repeat must be at least 1")
    if strip.shape[0] * a.repeat > s1 + 1:
        sys.exit(f"--repeat {a.repeat} adds {strip.shape[0] * a.repeat} rows but only {s1 + 1} rows of padding and neck lie above the strip's end: lower --repeat")
    strip = np.concatenate([strip] * a.repeat, axis=0)
    n = strip.shape[0]
    ext = np.concatenate([E[:s1 + 1], strip, E[s1 + 1:]], axis=0)[n:]  # the top n rows are plain backdrop: the base keeps its y
    if a.neck:
        rim, neck_end, shoulder_end = ints(a.neck, 3)
        if not (0 <= rim <= neck_end < shoulder_end < ext.shape[0]):
            sys.exit(f"--neck {a.neck} must satisfy 0 <= rim <= neck_end < shoulder_end < {ext.shape[0]}")
        if not np.isfinite(a.neck_widen) or a.neck_widen <= 0:
            sys.exit("--neck-widen must be finite and greater than zero")
        cx = a.cx if a.cx is not None else ext.shape[1] / 2   # the jar's centre; pass --cx when the pack is not centred in the photo
        if not np.isfinite(cx):
            sys.exit("--cx must be finite")
        ext = widen_neck(ext, rim, neck_end, shoulder_end, a.neck_widen, cx)
    Image.fromarray(ext).save(a.out, quality=95)
    print(f"{a.out}: neck extended by {n} px; the rim moved up {n} px; the box top is the old rim y minus {n}")


def _seam_blend(left, right, ov):
    """Join two pieces that overlap by `ov` columns along the vertical path where they differ least (no ghosting)."""
    h = left.shape[0]
    A, B = left[:, -ov:].astype(float), right[:, :ov].astype(float)
    cost = ((A - B) ** 2).sum(axis=2)
    acc = cost.copy()
    for y in range(1, h):
        prev = acc[y - 1]
        best = np.minimum(prev, np.minimum(np.r_[prev[1:], 1e18], np.r_[1e18, prev[:-1]]))
        acc[y] += best
    path = np.zeros(h, dtype=int)
    path[-1] = int(np.argmin(acc[-1]))
    for y in range(h - 2, -1, -1):
        x = path[y + 1]
        lo, hi = max(0, x - 1), min(ov, x + 2)
        path[y] = lo + int(np.argmin(acc[y, lo:hi]))
    cols = np.arange(ov)[None, :]
    take_right = cols >= path[:, None]
    mix = np.where(take_right[..., None], B, A)
    return np.concatenate([left[:, :-ov], mix.astype(np.uint8), right[:, ov:]], axis=1)


def vary_food(a):
    """Make N copies of a packshot whose kernels are arranged differently, so a row of identical packs does not show the same
    kernels four times. Each food region is rebuilt from random full-height strips of the real photo (random place, mirror and a
    slight width change), joined along minimum-difference seams. The left and right glass edges, the label, the cap and the
    horizontal glass highlights stay where they are, because the strips keep their height. Copy 1 is the photo unchanged."""
    import random
    pack = np.asarray(Image.open(a.packshot).convert("RGB")).copy()
    # more kernels to draw from: other photos of the same pack with the same framing (e.g. another flavour), graded to match
    extras = [np.asarray(Image.open(e).convert("RGB")) for e in (a.extra_src or [])]
    for e in extras:
        if e.shape != pack.shape:
            sys.exit("--extra-src must be the same size and framing as --packshot")
    regions = [ints(r, 4) for r in a.region]
    edge, ov = a.edge, a.overlap
    if a.count < 1:
        sys.exit("--count must be at least 1")
    if edge < 0 or ov < 1:
        sys.exit("--edge must be 0 or more and --overlap at least 1")
    if not (1 <= a.strip_min <= a.strip_max):
        sys.exit("--strip-min must be at least 1 and not above --strip-max")
    H0, W0 = pack.shape[:2]
    for (x0, y0, x1, y1) in regions:
        if not (0 <= x0 < x1 <= W0 and 0 <= y0 < y1 <= H0):
            sys.exit(f"a --region is outside the packshot ({W0}x{H0})")
        if x1 - x0 < 2 * edge + 2 * ov + 8:
            sys.exit(f"region {x0},{y0},{x1},{y1} is too narrow for --edge {edge} and --overlap {ov}")
    for k in range(1, a.count + 1):
        out = pack.copy()
        if k > 1:
            for ri, (x0, y0, x1, y1) in enumerate(regions):
                rng = random.Random(a.seed * 1000 + k * 17 + ri)
                R = pack[y0:y1, x0:x1]
                h, w = R.shape[:2]
                inners = [R[:, edge:w - edge]] + [e[y0:y1, x0 + edge:x1 - edge] for e in extras]   # kernels without the glass edges
                iw = inners[0].shape[1]
                canvas = R[:, :edge + ov].copy()                  # left glass edge
                used = []
                while canvas.shape[1] < w - edge:                  # enough width that the right glass edge is joined at w - edge exactly
                    sw = rng.randint(a.strip_min, a.strip_max)
                    for _ in range(40):                           # a start that is not near one already used in this jar
                        st = rng.randint(0, max(0, iw - sw))
                        if all(abs(st - u) > sw * 0.6 for u in used):
                            break
                    used.append(st)
                    piece = inners[rng.randrange(len(inners))][:, st:st + sw]
                    if rng.random() < 0.5:
                        piece = piece[:, ::-1]
                    nw = max(ov * 2 + 8, round(piece.shape[1] * rng.uniform(0.94, 1.06)))
                    piece = np.asarray(Image.fromarray(np.ascontiguousarray(piece)).resize((nw, h), Image.LANCZOS))
                    canvas = _seam_blend(canvas, piece, ov)
                right = R[:, w - edge - ov:]
                canvas = _seam_blend(canvas[:, :min(canvas.shape[1], w - edge)], right, ov) if canvas.shape[1] >= ov else canvas
                if canvas.shape[1] != w:                          # trim or pad (edge replicate) to the region width
                    canvas = canvas[:, :w] if canvas.shape[1] > w else np.pad(canvas, ((0, 0), (0, w - canvas.shape[1]), (0, 0)), mode="edge")
                # feather the top and bottom rows of the region into the original, so no hard line shows where the new rows start
                f = min(a.feather, h // 4)
                wy = np.ones(h)
                if f > 0:
                    ramp = np.linspace(0, 1, f + 2)[1:-1]
                    wy[:f] = ramp
                    wy[h - f:] = ramp[::-1]
                out[y0:y1, x0:x1] = (R * (1 - wy[:, None, None]) + canvas * wy[:, None, None]).astype(np.uint8)
        Image.fromarray(out).save(f"{a.out_prefix}{k}.jpg", quality=95)
        print(f"{a.out_prefix}{k}.jpg" + (" (the photo unchanged)" if k == 1 else ""))


def relight(a):
    """Make a pasted pack take the scene's light, so it does not look pasted: side shading across the cylinder (dark on the side away
    from the light), a soft fall-off at the edges, bounce light from the floor colour on the lower part, and a contact shadow
    where the pack meets the floor. Run it on the composite before the blend pass. The direction is the side the light comes from."""
    from PIL import ImageFilter
    scene = Image.open(a.scene).convert("RGB")
    arr = np.asarray(scene).astype(float)
    H, W = arr.shape[:2]
    x0, x1, top, base = ints(a.box, 4)
    if not (0 <= x0 < x1 <= W and 0 <= top < base <= H):
        sys.exit(f"--box {a.box} is outside the scene ({W}x{H})")
    if a.light not in ("left", "right"):
        sys.exit("--light must be left or right")
    bounce = np.array(rgb(a.floor), dtype=float)
    cx, half = (x0 + x1) / 2, (x1 - x0) / 2
    # jar mask: rounded box, soft edge
    m = Image.new("L", (W * 2, H * 2), 0)
    ImageDraw.Draw(m).rounded_rectangle((x0 * 2, top * 2, x1 * 2, base * 2), radius=36, fill=255)
    mask = np.asarray(m.resize((W, H), Image.LANCZOS).filter(ImageFilter.GaussianBlur(0.8))).astype(float) / 255
    xs = np.arange(W, dtype=float)
    u = np.clip((xs - cx) / half, -1, 1)
    toward = u if a.light == "left" else -u            # +1 on the side away from the light
    gain = 1 + a.shade * 0.35 - a.shade * (toward + 1) / 2
    gain *= 1 - a.edge * np.abs(u) ** 3
    ys = np.arange(H, dtype=float)
    if not np.isfinite(a.bounce_zone) or a.bounce_zone <= 0:
        sys.exit("--bounce-zone must be finite and greater than zero")
    w = np.clip((ys - (base - (base - top) * a.bounce_zone)) / ((base - top) * a.bounce_zone), 0, 1)[:, None]   # 0 above the zone, 1 at the base
    out = arr.copy()
    lit = arr * gain[None, :, None]
    lum = (arr.mean(axis=2, keepdims=True) / 255)
    lit = lit * (1 - a.bounce * w[..., None]) + (bounce[None, None, :] * (0.5 + lum)) * (a.bounce * w[..., None])
    out = out * (1 - mask[..., None]) + lit * mask[..., None]
    # contact shadow on the floor, outside the pack
    sh = Image.new("L", (W, H), 0)
    ImageDraw.Draw(sh).ellipse((x0 - half * 0.08, base - 10, x1 + half * 0.08, base + 16), fill=255)
    sh = np.asarray(sh.filter(ImageFilter.GaussianBlur(a.contact_blur))).astype(float) / 255
    dark = 1 - a.contact * sh * (1 - mask)
    out = out * dark[..., None]
    Image.fromarray(out.clip(0, 255).astype("uint8")).save(a.out, quality=95)
    print(f"{a.out}: light from the {a.light}, shade {a.shade}, bounce {a.bounce} of {a.floor}, contact {a.contact}")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("relight", help="make a pasted pack take the scene's light (side shading, floor bounce, contact shadow)")
    r.add_argument("--scene", required=True)
    r.add_argument("--box", required=True, help="x0,x1,top,base of the pack in the scene")
    r.add_argument("--light", required=True, help="the side the light comes from: left or right (a shadow that falls left means light from the right)")
    r.add_argument("--floor", default="120,80,55", help="R,G,B of the floor or surface the pack stands on (bounce light)")
    r.add_argument("--shade", type=float, default=0.30, help="how much darker the side away from the light gets (0 to 0.6)")
    r.add_argument("--edge", type=float, default=0.12, help="fall-off at both edges, for roundness")
    r.add_argument("--bounce", type=float, default=0.14, help="how much of the floor colour lights the lower part")
    r.add_argument("--bounce-zone", type=float, default=0.22, help="share of the pack's height, from the base, that gets bounce light")
    r.add_argument("--contact", type=float, default=0.55, help="darkness of the contact shadow under the pack")
    r.add_argument("--contact-blur", type=float, default=9)
    r.add_argument("--out", required=True)
    r.set_defaults(fn=relight)
    v = sub.add_parser("vary-food", help="N copies of a packshot with differently arranged kernels (for a row of identical packs)")
    v.add_argument("--packshot", required=True)
    v.add_argument("--region", action="append", required=True, help="x0,y0,x1,y1 of a food area; repeat for each")
    v.add_argument("--count", type=int, default=4)
    v.add_argument("--seed", type=int, default=7)
    v.add_argument("--extra-src", action="append", help="another photo of the pack, same size and framing; its kernels are mixed in")
    v.add_argument("--edge", type=int, default=34, help="px at each side kept as the real glass edge")
    v.add_argument("--overlap", type=int, default=18, help="px where two strips are joined along a seam")
    v.add_argument("--feather", type=int, default=7, help="px blended at the top and bottom of each region")
    v.add_argument("--strip-min", type=int, default=90)
    v.add_argument("--strip-max", type=int, default=125)
    v.add_argument("--out-prefix", required=True, help="writes <prefix>1.jpg ... <prefix>N.jpg (copy 1 is unchanged)")
    v.set_defaults(fn=vary_food)
    c = sub.add_parser("cutout", help="cut a product (not a rounded box) out of a plain dark or white backdrop into a mask file")
    c.add_argument("--packshot", required=True)
    c.add_argument("--out", required=True, help="the mask: a grey PNG the size of the packshot")
    c.add_argument("--dark-max", type=int, default=48, help="a pixel whose brightest channel is below this, joined to the border, is backdrop")
    c.add_argument("--light-sat", type=float, default=0.17, help="a light pixel with saturation below this, joined to the border, is backdrop")
    c.add_argument("--light-min", type=int, default=150, help="the lowest brightness of a light backdrop pixel")
    c.add_argument("--open", type=int, default=3, help="odd size of the opening filter: thin lines narrower than this are removed (3 keeps fine edges, 7 removes a horizon line)")
    c.add_argument("--seed-step", type=int, default=7, help="try every Nth border pixel as a flood fill start")
    c.set_defaults(fn=cutout)
    d = sub.add_parser("pad45", help="pad a square packshot to 4:5 for a model edit")
    d.add_argument("--packshot", required=True)
    d.add_argument("--out", required=True)
    d.set_defaults(fn=pad45)
    o = sub.add_parser("open-source", help="real photo + a model-drawn open neck at the same camera angle (a cap-off product)")
    o.add_argument("--padded", required=True, help="the padded packshot that was sent to the model")
    o.add_argument("--edit", required=True, help="the model's edit of it (cap off, same framing)")
    o.add_argument("--real-from", type=int, required=True, help="padded y inside the label's top band: from here down the real photo is used")
    o.add_argument("--strip", required=True, help="y0,y1 of a strip of the neck's threads to repeat (a whole number of thread periods)")
    o.add_argument("--repeat", type=int, default=1, help="how many copies of the strip to add (each copy adds the strip's height)")
    o.add_argument("--neck", help="rim_y,neck_end_y,shoulder_end_y in the output: widen the neck rows (see widen_neck)")
    o.add_argument("--neck-widen", type=float, default=1.05, help="widen factor for the neck (the model draws it at 0.90 of the body width; the real one is about 0.95)")
    o.add_argument("--cx", type=float, default=None, help="centre x of the jar in the padded packshot (default: the middle of the picture)")
    o.add_argument("--out", required=True)
    o.set_defaults(fn=open_source)
    s = sub.add_parser("skeleton")
    s.add_argument("--packshot", required=True)
    s.add_argument("--box", required=True, help="x0,y0,x1,y1 of the product in the packshot")
    s.add_argument("--size", default="1024x1280".replace("x", ","), help="W,H of the canvas (default 1024,1280)")
    s.add_argument("--bg", required=True, help="canvas colour: R,G,B or #rrggbb (the look's backdrop colour)")
    s.add_argument("--jar-height", type=float, required=True, help="product height, fraction of the canvas height")
    s.add_argument("--cx", type=float, default=0.5, help="centre x, fraction of the width")
    s.add_argument("--base", type=float, default=0.9, help="y of the product's base, fraction of the height")
    s.add_argument("--alpha", help="a silhouette mask the size of the packshot (from `cutout`) instead of a rounded box")
    s.add_argument("--count", type=int, default=1)
    s.add_argument("--gap", type=float, default=0.18, help="gap between products, fraction of one product's width")
    s.add_argument("--out", required=True)
    s.set_defaults(fn=skeleton)
    w = sub.add_parser("swap")
    w.add_argument("--packshot", required=True)
    w.add_argument("--box", required=True)
    w.add_argument("--scene", required=True)
    w.add_argument("--old", required=True, help="x0,x1,top,base of the old product in the scene")
    w.add_argument("--scale", type=float, help="paste at this scale (packshot pixels to scene pixels) instead of fitting --old")
    w.add_argument("--cx", type=float, help="centre x of the pasted piece (default: the centre of --old)")
    w.add_argument("--alpha", help="a silhouette mask the size of the packshot (from `cutout`) instead of a rounded box")
    w.add_argument("--lower-only", action="store_true")
    w.add_argument("--band-top", type=int, help="y of the label's top band in the packshot (with --lower-only)")
    w.add_argument("--out", required=True)
    w.set_defaults(fn=swap)
    a = p.parse_args()
    if a.cmd == "skeleton" and "x" in a.size:
        a.size = a.size.replace("x", ",")
    a.fn(a)


if __name__ == "__main__":
    main()
