#!/usr/bin/env python3
"""Product lock: put the REAL product pixels into a layout, so its shape is right by construction.

Why: a model redraws a product from a photo and drifts (W46c: the jar came out 9% too squat, the cap too short).
A model keeps what is already in its input image. So we place the real product, cut from the packshot, at the exact
proportions, and the model only builds the scene around it (creative-playbook.md section 7.4).

Needs Python 3 with Pillow and numpy (reprint also needs OpenCV: opencv-python-headless, scripts/requirements.txt). Runs on the owner's machine or in the session, not in the Worker.

  skeleton  A blank canvas with N real products placed on it. Use it as the ONLY reference of a draft.
            Each draft gets its own placement, so the 3 drafts of an idea differ in layout, scale and crop.
  cutout    Make a silhouette mask for a product that is not a rounded box (a cake on its box, on a dark or white backdrop).
            Pass it as --alpha to skeleton and swap.
  layout    A skeleton from a plan file: each product at its own place, size, side (standing or lying) and small turn,
            over flat shapes that draw real-scale cues (tile rows, a worktop edge). Use it for groups and true scale.
            A plan product may name its own real photo ("photo", with an "alpha" from `cutout`): for a range of
            different items (engine 3, owner 18-11-2026: model-drawn cake slices were "ai food slop"; the brand's
            real slice photos, cut out and composed, were kept by the model).
  reprint   Put the real packshot print back on each product of a render made from a layout skeleton (the model smears small print).
  swap      Replace the product in an existing draft or final with the real one (repair of a picked draft).
            --lower-only keeps the scene above the label: for an open, almost empty jar (the packshot cannot show that
            state, so only the label and the base are real pixels).

--box is the product's silhouette in the packshot: x0,y0,x1,y1 in pixels (read it from a grid overlay of the packshot).
"""
import argparse
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

# Open only the formats we use; Pillow refuses any other file type.
FORMATS = ["JPEG", "PNG", "WEBP"]

PAD = 4  # px of packshot kept around the silhouette, so the edge is not cut


def ints(s, n):
    v = [int(float(x)) for x in s.split(",")]
    if len(v) != n:
        sys.exit(f"expected {n} numbers: {s}")
    return v


def check_box(box, size, flag="--box"):
    """A box must lie inside the image and have a width and a height."""
    x0, y0, x1, y1 = box
    W, H = size
    if not (0 <= x0 < x1 <= W and 0 <= y0 < y1 <= H):
        sys.exit(f"{flag} {x0},{y0},{x1},{y1} is outside the packshot ({W}x{H}) or not x0<x1, y0<y1")


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


def alpha_from_png(path, box, size, packshot_size=None):
    """The product's own silhouette from a mask file (made by `cutout`), cropped like the piece and resized to it."""
    m = Image.open(path, formats=FORMATS).convert("L")
    if packshot_size is not None and m.size != packshot_size:
        sys.exit(f"{path} is {m.size[0]}x{m.size[1]} but the packshot is {packshot_size[0]}x{packshot_size[1]}: make the mask from this packshot with `cutout`.")
    return m.crop(box).resize(size, Image.LANCZOS)


def cutout(a):
    """Cut a product out of a packshot with a plain backdrop (dark and/or white), for products that are not a rounded box
    (a cake on its box). A dark pixel (max channel below --dark-max) or a light unsaturated pixel (saturation below --light-sat and
    brightness above --light-min) that is joined to the picture's border is backdrop; everything else is the product.
    The mask is opened (--open px) and eroded by 1 px (no specks, thin lines or fringe), reduced to its largest piece, and softened a little."""
    from PIL import ImageFilter
    if a.open < 1 or a.open % 2 == 0:
        sys.exit("--open must be a positive odd integer")
    if not np.isfinite(a.smooth) or a.smooth < 0:
        sys.exit("--smooth must be finite and zero or greater")
    if a.erode < 0:
        sys.exit("--erode must be zero or greater")
    edges = {e.strip() for e in a.edges.split(",")}
    if not edges <= {"top", "bottom", "left", "right"}:
        sys.exit("--edges takes top, bottom, left, right, separated by commas")
    im = Image.open(a.packshot, formats=FORMATS).convert("RGB")
    arr = np.asarray(im).astype(int)
    H, W = arr.shape[:2]
    mx, mn = arr.max(axis=2), arr.min(axis=2)
    sat = (mx - mn) / np.maximum(mx, 1)
    lum = arr.mean(axis=2)
    smooth = None
    if a.smooth > 0:  # local standard deviation of brightness in a 5x5 window: a plain backdrop is smooth, a dark textured product is not
        def box(v, k=5):
            p = k // 2
            c = np.pad(np.cumsum(np.cumsum(np.pad(v, p, mode="edge"), 0), 1), ((1, 0), (1, 0)))
            return (c[k:, k:] - c[:-k, k:] - c[k:, :-k] + c[:-k, :-k]) / (k * k)
        smooth = np.sqrt(np.maximum(box(lum ** 2) - box(lum) ** 2, 0)) < a.smooth
    border = (
        ([(x, 0) for x in range(W)] if "top" in edges else [])
        + ([(x, H - 1) for x in range(W)] if "bottom" in edges else [])
        + ([(0, y) for y in range(H)] if "left" in edges else [])
        + ([(W - 1, y) for y in range(H)] if "right" in edges else [])
    )

    def backdrop(cls):
        b = Image.fromarray((cls * 255).astype("uint8"), "L")
        out = np.zeros((H, W), bool)
        for s in border:
            if b.getpixel(s) == 255 and not out[s[1], s[0]]:
                t = b.copy()
                ImageDraw.floodfill(t, s, 128)
                out |= np.asarray(t) == 128
        return out

    bg = backdrop((mx < a.dark_max) & (smooth if smooth is not None else True)) | backdrop((sat < a.light_sat) & (mx > a.light_min))
    if not bg.any():
        sys.exit("no backdrop found on the chosen --edges. Check --dark-max, --light-sat and --edges (an edge the product fills is not backdrop).")
    m = Image.fromarray(((~bg) * 255).astype("uint8"), "L").filter(ImageFilter.MinFilter(a.open)).filter(ImageFilter.MaxFilter(a.open))
    for _ in range(a.erode):
        m = m.filter(ImageFilter.MinFilter(3))
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
    soft = Image.fromarray((best * 255).astype("uint8"), "L").filter(ImageFilter.GaussianBlur(0.9))
    soft.point(lambda v: 0 if v < 110 else min(255, (v - 110) * 255 // 110)).save(a.out)  # drops the faint rim a blurred hairline leaves
    ys, xs = np.where(best)
    print(f"{a.out}: product box x {xs.min()},{xs.max() + 1} y {ys.min()},{ys.max() + 1} ({int(best.sum())} px of {W * H}). Use --box {xs.min()},{ys.min()},{xs.max() + 1},{ys.max() + 1} --alpha {a.out}")


def cut(pack, box, band_top=None):
    x0, y0, x1, y1 = box
    top = band_top if band_top is not None else y0
    return pack.crop((x0 - PAD, top - PAD if band_top is None else top, x1 + PAD, y1 + PAD))


def skeleton(a):
    pack = Image.open(a.packshot, formats=FORMATS).convert("RGB")
    W, H = ints(a.size, 2)
    x0, y0, x1, y1 = ints(a.box, 4)
    check_box((x0, y0, x1, y1), pack.size)
    piece = cut(pack, (x0, y0, x1, y1))
    jar_h = round(H * a.jar_height)
    scale = jar_h / (y1 - y0 + 2 * PAD)
    piece = piece.resize((round(piece.width * scale), round(piece.height * scale)), Image.LANCZOS)
    mask = alpha_from_png(a.alpha, (x0 - PAD, y0 - PAD, x1 + PAD, y1 + PAD), piece.size, pack.size) if a.alpha else alpha(piece.size, scale)
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
    pack = Image.open(a.packshot, formats=FORMATS).convert("RGB")
    scene = Image.open(a.scene, formats=FORMATS).convert("RGB")
    x0, y0, x1, y1 = ints(a.box, 4)
    check_box((x0, y0, x1, y1), pack.size)
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
    mask = alpha_from_png(a.alpha, (x0 - PAD, y0 - PAD, x1 + PAD, y1 + PAD), piece.size, pack.size) if a.alpha else alpha(piece.size, scale, square_top=a.lower_only)
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
    im = np.asarray(Image.open(a.packshot, formats=FORMATS).convert("RGB"))
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
    pad = Image.open(a.padded, formats=FORMATS).convert("RGB")
    edit = Image.open(a.edit, formats=FORMATS).convert("RGB").resize(pad.size, Image.LANCZOS)
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
    pack = np.asarray(Image.open(a.packshot, formats=FORMATS).convert("RGB")).copy()
    # more kernels to draw from: other photos of the same pack with the same framing (e.g. another flavour). This step does not grade them: grade each to match first (food_grade.py)
    extras = [np.asarray(Image.open(e, formats=FORMATS).convert("RGB")) for e in (a.extra_src or [])]
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
    scene = Image.open(a.scene, formats=FORMATS).convert("RGB")
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

SIDES = ("up", "L", "R")


def load_plan(path):
    """A layout plan (JSON): the canvas, flat shapes for the room's real-scale cues, and each product's place.
    {"size": [1024, 1280], "bg": "#EEE8DF",
     "shapes": [{"rect": [x0, y0, x1, y1], "fill": "#F6F5F2"}, ...],              (fractions, drawn in order, under the products)
     "products": [{"cx": 0.24, "base": 0.77, "height": 0.21, "side": "R", "rot": -0.6}, ...]}
    cx: centre x; base: y of the lowest point; height: the product's own length (cap to base); all fractions of the canvas.
    side: "up" (standing), "L" (lying, top to the left) or "R" (lying, top to the right; its print reads left to right).
    rot: a small turn in degrees (counter-clockwise), so a group looks put down by a person (creative-playbook 7.4 A).
    A product may also give its own real photo (a range of different items, such as cake slices of each flavour):
    "photo": the file, "alpha": its mask from `cutout` (same size), "box": [x0, y0, x1, y1] px in that photo (default: the
    mask's box), "blur": px of softness for an item further back. Paths are relative to the plan file. Without "photo"
    the product is the --packshot."""
    import json
    try:
        with open(path) as f:
            plan = json.load(f)
    except (OSError, ValueError) as e:
        sys.exit(f"cannot read the plan {path}: {e}")
    if not isinstance(plan, dict) or not isinstance(plan.get("products"), list) or not plan["products"]:
        sys.exit("the plan needs a non-empty \"products\" list")
    size = plan.get("size", [1024, 1280])
    if not (isinstance(size, list) and len(size) == 2 and all(isinstance(v, int) and v > 0 for v in size)):
        sys.exit("the plan's \"size\" must be [W, H] in whole pixels")
    def num(v):
        return isinstance(v, (int, float)) and not isinstance(v, bool) and np.isfinite(v)
    for i, q in enumerate(plan["products"]):
        if not isinstance(q, dict):
            sys.exit(f"product {i + 1}: must be an object")
        q.setdefault("side", "up")
        q.setdefault("rot", 0)
        if q["side"] not in SIDES:
            sys.exit(f"product {i + 1}: side must be one of {', '.join(SIDES)}")
        for k in ("cx", "base", "height", "rot"):
            if not num(q.get(k)):
                sys.exit(f"product {i + 1}: {k} must be a number")
        if not (0 < q["height"] <= 1.5 and -0.5 <= q["cx"] <= 1.5 and 0 < q["base"] <= 1.5 and abs(q["rot"]) <= 45):
            sys.exit(f"product {i + 1}: height must be above 0, cx and base near the canvas, rot within 45 degrees")
        for k in ("photo", "alpha"):
            if k in q:
                if not (isinstance(q[k], str) and q[k]):
                    sys.exit(f"product {i + 1}: {k} must be a file name")
                q[k] = os.path.join(os.path.dirname(os.path.abspath(path)), q[k])
        if ("alpha" in q or "box" in q) and "photo" not in q:
            sys.exit(f"product {i + 1}: alpha and box go with its own photo")
        if "photo" in q and "alpha" not in q and "box" not in q:
            sys.exit(f"product {i + 1}: a photo needs its alpha (from cutout) or its box")
        if "box" in q and not (isinstance(q["box"], list) and len(q["box"]) == 4 and all(isinstance(v, int) and not isinstance(v, bool) for v in q["box"])):
            sys.exit(f"product {i + 1}: box must be [x0, y0, x1, y1] in whole pixels")
        if not (num(q.get("blur", 0)) and 0 <= q.get("blur", 0) <= 20):
            sys.exit(f"product {i + 1}: blur must be from 0 to 20 px")
    for i, sh in enumerate(plan.get("shapes", [])):
        r = sh.get("rect") if isinstance(sh, dict) else None
        if not (isinstance(r, list) and len(r) == 4 and all(num(v) for v in r) and r[0] < r[2] and r[1] < r[3]):
            sys.exit(f"shape {i + 1}: rect must be [x0, y0, x1, y1] fractions with x0<x1, y0<y1")
        rgb(str(sh.get("fill", "#808080")))
    return plan


def product_piece(pack, box, alpha_path):
    """The real product cut from the packshot (with PAD) and its mask, at packshot scale, as one RGBA image."""
    x0, y0, x1, y1 = box
    piece = cut(pack, box)
    mask = alpha_from_png(alpha_path, (x0 - PAD, y0 - PAD, x1 + PAD, y1 + PAD), piece.size, pack.size) if alpha_path else alpha(piece.size, 1.0)
    piece = piece.convert("RGBA")
    piece.putalpha(mask)
    return piece


def turn(img, length_px, side, rot):
    """Scale a packshot-scale piece so its own length (cap to base) is length_px, lay it down for side L or R, then turn it by rot."""
    k = length_px / img.height
    out = img.resize((max(1, round(img.width * k)), max(1, round(length_px))), Image.LANCZOS)
    if side == "L":
        out = out.rotate(90, expand=True, resample=Image.BICUBIC)
    elif side == "R":
        out = out.rotate(-90, expand=True, resample=Image.BICUBIC)
    if rot:
        out = out.rotate(rot, expand=True, resample=Image.BICUBIC)
    return out


def corner(q, img, W, H):
    """Top-left corner of a turned RGBA piece whose visible product (its alpha box, not the padded image) is centred at the
    plan's cx and has its lowest point at the plan's base."""
    b = img.getchannel("A").getbbox() or (0, 0, img.width, img.height)
    return round(q["cx"] * W - (b[0] + b[2]) / 2), round(q["base"] * H - b[3])


def photo_piece(q):
    """A plan product's own real photo, cut out with its mask, and its box (default: the mask's box)."""
    try:
        photo = Image.open(q["photo"], formats=FORMATS).convert("RGB")
    except OSError as e:
        sys.exit(f"cannot read the photo {q['photo']}: {e}")
    box = q.get("box")
    if box is None:
        m = Image.open(q["alpha"], formats=FORMATS).convert("L")
        box = list(m.point(lambda v: 255 if v > 127 else 0).getbbox() or ())
        if not box:
            sys.exit(f"{q['alpha']} is empty: no product in the mask")
        box = [max(PAD, box[0]), max(PAD, box[1]), min(photo.width - PAD, box[2]), min(photo.height - PAD, box[3])]
    check_box(box, photo.size, f"the box of {os.path.basename(q['photo'])}")
    return product_piece(photo, box, q.get("alpha")), box


def soften(img, r):
    """An RGBA piece blurred by r px, on a clear margin so the soft edge is not cut at the piece's border, and that margin."""
    from PIL import ImageFilter
    pad = int(np.ceil(3 * r))
    big = Image.new("RGBA", (img.width + 2 * pad, img.height + 2 * pad), (0, 0, 0, 0))
    big.paste(img, (pad, pad))
    v = np.asarray(big).astype(np.float32)
    al = v[..., 3:] / 255
    pre = Image.fromarray(np.clip(v[..., :3] * al, 0, 255).astype("uint8")).filter(ImageFilter.GaussianBlur(r))
    wa = Image.fromarray((al[..., 0] * 255).astype("uint8"), "L").filter(ImageFilter.GaussianBlur(r))
    wsum = np.asarray(wa).astype(np.float32)[..., None] / 255
    out = Image.fromarray(np.clip(np.asarray(pre).astype(np.float32) / np.maximum(wsum, 1e-3), 0, 255).astype("uint8")).convert("RGBA")
    out.putalpha(Image.fromarray((al[..., 0] * 255).astype("uint8"), "L").filter(ImageFilter.GaussianBlur(r * 0.6)))
    return out, pad


def layout(a):
    """A skeleton from a plan: products at their own places, sizes, sides and small turns (a messy stack, a loose group, one upright),
    over flat shapes that draw the room's real-scale cues (tile rows, a worktop edge). The model then builds the scene around them."""
    plan = load_plan(a.plan)
    if a.packshot:
        pack = Image.open(a.packshot, formats=FORMATS).convert("RGB")
        if not a.box:
            sys.exit("--packshot needs --box")
        box = ints(a.box, 4)
        check_box(box, pack.size)
    elif any("photo" not in q for q in plan["products"]):
        sys.exit("give --packshot and --box, or a photo for every product of the plan")
    W, H = plan["size"]
    canvas = Image.new("RGBA", (W, H), rgb(str(plan.get("bg", "#E9E4DC"))) + (255,))
    d = ImageDraw.Draw(canvas)
    for sh in plan.get("shapes", []):
        x0, y0, x1, y1 = sh["rect"]
        d.rectangle((round(x0 * W), round(y0 * H), round(x1 * W) - 1, round(y1 * H) - 1), fill=rgb(str(sh.get("fill", "#808080"))))
    pieces = {}
    if a.packshot:
        pieces[None] = (product_piece(pack, box, a.alpha), box)
    boxes = []
    for q in plan["products"]:
        key = (q["photo"], q.get("alpha"), tuple(q.get("box") or ())) if "photo" in q else None
        if key not in pieces:
            pieces[key] = photo_piece(q)
        piece, pbox = pieces[key]
        img = turn(piece, q["height"] * H * piece.height / (pbox[3] - pbox[1]), q["side"], q["rot"])
        x, y = corner(q, img, W, H)   # from the sharp piece: a blur does not move the item
        if q.get("blur"):  # an item further back: soft, blurred with its own alpha so no backdrop colour bleeds in
            img, pad = soften(img, q["blur"])
            x, y = x - pad, y - pad
        layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))   # paste clips a piece that bleeds off an edge; alpha_composite refuses it
        layer.paste(img, (x, y))   # no mask: a mask would apply the alpha twice and leave a dark ring on every soft edge
        canvas.alpha_composite(layer)
        print(f"product {len(boxes) + 1}: x {x},{x + img.width} y {y},{y + img.height}")
        boxes.append((x, y))
    canvas.convert("RGB").save(a.out, quality=95)
    shape = f", H/W {(box[3] - box[1]) / (box[2] - box[0]):.3f}" if a.packshot else ""
    print(f"{a.out}: {len(plan['products'])} products on {W}x{H}{shape}")


def reprint(a):
    """Put the real print back on each product of a render made from a `layout` skeleton. The model smears small print
    (W47 Oatside: the Nutri-Grade label and the vitamin badge came out as mirrored scribbles). For each product of the plan,
    the packshot's printed face is fitted to the render (scale, turn and position near the plan's place), then pasted with the
    render's own light: the light is read only where both show the pack's plain base colour, so a moved logo or badge leaves no glow.
    The edges, the cap and the top folds stay the render's. A product that does not fit (a weak score) is left as it is."""
    import cv2
    pack = Image.open(a.packshot, formats=FORMATS).convert("RGB")
    box = ints(a.box, 4)
    check_box(box, pack.size)
    face = ints(a.face, 4)
    if not (box[0] <= face[0] < face[2] <= box[2] and box[1] <= face[1] < face[3] <= box[3]):
        sys.exit(f"--face {a.face} must lie inside --box {a.box}, with x0<x1 and y0<y1")
    if not (np.isfinite(a.min_score) and 0 < a.min_score < 1):
        sys.exit("--min-score must be between 0 and 1")
    if not (np.isfinite(a.search_scale) and 0 <= a.search_scale < 1):
        sys.exit("--search-scale must be 0 or more and below 1")
    if not (np.isfinite(a.search_rot) and 0 <= a.search_rot <= 45):
        sys.exit("--search-rot must be from 0 to 45 degrees")
    if a.search_px < 0:
        sys.exit("--search-px must be 0 or more")
    if not (np.isfinite(a.light_px) and a.light_px > 0):
        sys.exit("--light-px must be above 0")
    plan = load_plan(a.plan)
    if any("photo" in q for q in plan["products"]):
        sys.exit("reprint puts one packshot's print back: this plan has products with their own photos")
    render = Image.open(a.render, formats=FORMATS).convert("RGB")
    W, H = render.size
    pw, ph = plan["size"]
    if abs(W / H - pw / ph) > 0.01:
        sys.exit(f"the render ({W}x{H}) and the plan ({pw}x{ph}) do not have the same shape")
    piece = product_piece(pack, box, a.alpha)
    fm = Image.new("L", piece.size, 0)       # the printed face, in piece pixels
    ImageDraw.Draw(fm).rectangle((face[0] - box[0] + PAD, face[1] - box[1] + PAD, face[2] - box[0] + PAD - 1, face[3] - box[1] + PAD - 1), fill=255)
    fpiece = piece.copy()
    fpiece.putalpha(Image.fromarray(np.minimum(np.asarray(fm), np.asarray(piece.getchannel("A")))))
    R = np.asarray(render).astype(np.float32)
    G = R.mean(axis=2)
    out = R.copy()
    debug = np.zeros((H, W), np.float32)
    lp = lambda v: cv2.GaussianBlur(v, (0, 0), max(2.0, a.light_px * W / 1536))
    fitted = 0
    for i, q in enumerate(plan["products"]):
        length = q["height"] * H * piece.height / (box[3] - box[1])
        best = (-2.0,)
        for s in np.arange(1 - a.search_scale, 1 + a.search_scale + 1e-9, 0.01):
            for dr in np.linspace(-a.search_rot, a.search_rot, 5):
                timg = turn(piece, length * s, q["side"], q["rot"] + dr)
                t = np.asarray(timg.convert("RGB")).mean(axis=2).astype(np.float32)
                th, tw = t.shape
                iy, ix = int(th * 0.18), int(tw * 0.18)   # the inner part only: no backdrop and no rotated corners in the template
                ti = t[iy:th - iy, ix:tw - ix]
                x, y = corner(q, timg, W, H)   # the same place as layout put it
                pad = round(a.search_px * W / 1536)
                x0, y0 = max(0, x - pad), max(0, y - pad)
                sub = G[y0:min(H, y + th + pad), x0:min(W, x + tw + pad)]
                if sub.shape[0] < ti.shape[0] or sub.shape[1] < ti.shape[1] or ti.std() < 1:
                    continue
                r = cv2.matchTemplate(sub, ti, cv2.TM_CCOEFF_NORMED)
                _, mv, _, ml = cv2.minMaxLoc(r)
                if mv > best[0]:
                    best = (mv, s, dr, x0 + ml[0] - ix, y0 + ml[1] - iy)
        if best[0] < a.min_score:
            print(f"product {i + 1}: no good fit (score {max(best[0], 0):.3f} below {a.min_score}); left as rendered")
            continue
        mv, s, dr, x, y = best
        img = np.asarray(turn(fpiece, length * s, q["side"], q["rot"] + dr)).astype(np.float32)
        new, m = img[..., :3], img[..., 3] / 255
        m = cv2.GaussianBlur(cv2.erode(m, np.ones((5, 5), np.uint8)), (0, 0), max(1.5, 3.0 * W / 1536))   # the face edge sits on plain pack: a soft seam
        # clip the piece to the picture
        h, w = m.shape
        cx0, cy0, cx1, cy1 = max(0, x), max(0, y), min(W, x + w), min(H, y + h)
        if cx1 <= cx0 or cy1 <= cy0:
            print(f"product {i + 1}: fitted outside the picture; left as rendered")
            continue
        new, m = new[cy0 - y:cy1 - y, cx0 - x:cx1 - x], m[cy0 - y:cy1 - y, cx0 - x:cx1 - x]
        reg = R[cy0:cy1, cx0:cx1]
        # light from the pack's plain base colour only: where the packshot face shows it, and the render shows a near-neutral version of it
        fpx = new.reshape(-1, 3)[m.reshape(-1) > 0.5]
        if len(fpx) < 50:
            print(f"product {i + 1}: too little of its face is inside the picture; left as rendered")
            continue
        base_col = np.median(fpx, axis=0)
        paper = (np.abs(new - base_col).max(axis=2) < 28) * m
        chroma = lambda v: v / np.maximum(v.sum(axis=2, keepdims=True), 1)
        paper *= (np.abs(chroma(reg) - chroma(base_col[None, None])).max(axis=2) < 0.05) * (reg.mean(axis=2) > 0.3 * base_col.mean())
        rl, fl = reg.mean(axis=2), new.mean(axis=2)
        for _ in range(2):   # the second pass drops render pixels darker than the light predicts (smeared print bleeding grey)
            den = np.maximum(lp(paper), 1e-4)
            shade = np.clip((lp(rl * paper) / den) / np.maximum(lp(fl * paper) / den, 1), 0.3, 1.3)
            paper = paper * (rl > 0.94 * shade * fl)
        den = np.maximum(lp(paper), 1e-4)
        tint = lp(reg * paper[..., None]) / den[..., None]
        tint = tint / np.maximum(tint.mean(axis=2, keepdims=True), 1)
        # far from any plain pack colour (a big logo, a badge) the local light is a guess: blend to the product's mean light there
        sup = np.clip(den * 4, 0, 1)
        on = paper > 0.5
        if on.sum() < 50:
            print(f"product {i + 1}: too little plain pack colour to read the light from; left as rendered")
            continue
        g_shade = float(np.clip(np.median(rl[on] / np.maximum(fl[on], 1)), 0.3, 1.3))
        g_tint = np.median(reg[on], axis=0)
        g_tint = g_tint / max(g_tint.mean(), 1)
        # the render's colour holds the pack's own base colour too: divide it out, or a coloured base (a kraft pouch) is tinted twice
        own = base_col / max(float(base_col.mean()), 1)
        ok = own >= 0.05                                     # a channel the base hardly holds gives no reliable light: keep it neutral
        tint = np.divide(tint, own, out=np.ones_like(tint), where=np.broadcast_to(ok, tint.shape))
        g_tint = np.divide(g_tint, own, out=np.ones_like(g_tint), where=ok)
        shade = sup * shade + (1 - sup) * g_shade
        tint = sup[..., None] * tint + (1 - sup[..., None]) * g_tint
        lit = np.clip(new * shade[..., None] * tint, 0, 255)
        out[cy0:cy1, cx0:cx1] = out[cy0:cy1, cx0:cx1] * (1 - m[..., None]) + lit * m[..., None]
        debug[cy0:cy1, cx0:cx1] = np.maximum(debug[cy0:cy1, cx0:cx1], m)
        fitted += 1
        print(f"product {i + 1}: fit {mv:.3f}, scale {s:.2f}, turn {q['rot'] + dr:+.1f} deg, at {x},{y}")
    if fitted == 0:
        sys.exit("no product fitted: check that the plan is the one the render was made from, and --box and --face")
    Image.fromarray(out.clip(0, 255).astype("uint8")).save(a.out, quality=97, subsampling=0)
    if a.debug:
        Image.fromarray((debug * 255).astype("uint8")).save(a.debug)
    print(f"{a.out}: real print on {fitted} of {len(plan['products'])} products")



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
    c.add_argument("--smooth", type=float, default=0, help="0 = off. Above 0, a dark pixel counts as backdrop only where the picture is smooth (local brightness std below this, 2.0 works): keeps a dark textured product, such as a brownie, on a black backdrop")
    c.add_argument("--erode", type=int, default=1, help="how many 1 px erosions to apply at the end (more removes a dark fringe of backdrop)")
    c.add_argument("--edges", default="top,bottom,left,right", help="which picture edges the backdrop may touch (comma list). Drop an edge where a dark or pale part of the product touches it, so it is not read as backdrop")
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
    y = sub.add_parser("layout", help="a skeleton from a plan file: products at their own places, sides and small turns, over flat real-scale cues")
    y.add_argument("--packshot", help="the product for every plan product without its own photo")
    y.add_argument("--box", help="x0,y0,x1,y1 of the product in the packshot")
    y.add_argument("--alpha", help="a silhouette mask the size of the packshot (from `cutout`) instead of a rounded box")
    y.add_argument("--plan", required=True, help="the plan JSON (see load_plan); keep it: reprint needs the same plan")
    y.add_argument("--out", required=True)
    y.set_defaults(fn=layout)
    e = sub.add_parser("reprint", help="put the real packshot print back on each product of a render made from a layout skeleton")
    e.add_argument("--packshot", required=True)
    e.add_argument("--box", required=True, help="the same --box as for layout")
    e.add_argument("--alpha", help="the same --alpha as for layout")
    e.add_argument("--face", required=True, help="x0,y0,x1,y1 of the printed face in the packshot: below the cap and the top folds, inside the edges")
    e.add_argument("--plan", required=True, help="the plan the render's skeleton was made from")
    e.add_argument("--render", required=True, help="the raw render (draft or final), before photo_finish and headline")
    e.add_argument("--out", required=True)
    e.add_argument("--debug", help="writes the paste mask (PNG) here")
    e.add_argument("--min-score", type=float, default=0.8, help="a product whose fit scores lower is left as rendered")
    e.add_argument("--search-scale", type=float, default=0.08, help="how far the size may differ from the plan (fraction)")
    e.add_argument("--search-rot", type=float, default=1.5, help="how far the turn may differ from the plan (degrees)")
    e.add_argument("--search-px", type=int, default=70, help="how far the place may differ from the plan (px at 1536 wide)")
    e.add_argument("--light-px", type=float, default=14, help="blur of the light map (px at 1536 wide)")
    e.set_defaults(fn=reprint)
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
