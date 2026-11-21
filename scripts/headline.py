"""Set the headline and the subline on a picture in the brand's real font.

The image model cannot draw a given font: it paints a look-alike (W46 rerun, owner
12-11-2026: "it doesn't use the brand's own font type"). So the render leaves the text
area as plain backdrop, and this script sets the words with the real font file.

python3 scripts/headline.py --in draft.jpg --out draft-text.jpg --family "Oswald" \
    --headline "S$58.90 ends the debate." --subline "Ten flavours, one cake." \
    --area 0.50,0.18,0.95,0.45 [--wght 600] [--sub-wght 400] [--color 000000] [--align left]

The display style that the owner approved (W47 v3 pack, owner 16-11-2026: the sentence-case
SemiBold set "simply really really ugly and ill fitting"): the headline in capitals at the family's
heaviest weight with tight leading, stacked in the empty side of the picture, and a bold subline:

python3 scripts/headline.py ... --wght 700 --sub-wght 600 --case upper --leading 1.0 \
    --area 0.50,0.17,0.95,0.43 --accent "TEN?" --accent-color DD4430

--case upper sets the headline in capitals (--sub-case upper, the subline). --leading is the step
between headline lines, x the font size (capitals have no descenders, so 0.95 to 1.0 is right; keep
1.05 for mixed case). --align center centres each line in the area. --accent names one or more
headline words (matched without case) that are set in --accent-color, the kit's accent colour.
A " | " in the headline forces a line break there (the words stay the approved words), so a line can
end on the idea, as in "WAIT, | THERE'S TEN?".

The font, for every brand: give --family with the brand kit's font name (brand_get kit.fonts; the
first one is the headline font unless the kit notes say otherwise). The script gets that family at
the weight from Google Fonts and keeps the file in --cache. A brand font that is not on Google Fonts
(a licensed or custom font): download the file that the brand's own site serves (its @font-face url)
and give it with --font. --fallback names a second family that is used only when the first cannot be
found; the script then prints FALLBACK, and the owner must be told before he judges the type.
--sub-family or --sub-font sets the subline in another kit font (default: the headline font).

--area is the text box as fractions of the width and height (x0,y0,x1,y1). The script
finds the largest headline size whose lines fit the box (up to 3 lines, words never split),
sets the subline at --sub-ratio of that size under it, and prints the text's top and
bottom as a percentage of the height, so the logo gap can be checked. A variable font
takes --wght and --sub-wght on its weight axis. It stops with a clear message, and
writes nothing, when the font or the picture is missing or the words cannot fit.

The engine 3 lockup (owner, 18-11-2026: the pie chart type "isn't big enough", unlike "This one." and
"Too slow."): big stacked capitals with a subline about half the headline size and clear air above the
food. --min-head stops the script when the headline comes out smaller than that share of the picture
height (make the area larger or break the lines with " | "); --product-top gives the top of the product
(fraction of the height) and the script stops when the text ends less than --min-clear (default 0.04)
above it:

python3 scripts/headline.py ... --case upper --leading 0.95 --sub-ratio 0.5 --gap 0.35 \
    --min-head 0.07 --product-top 0.52 --headline "THE ONLY | PIE CHART | I LIKE."

Breathing space (owner, 20-11-2026): the script stops when the area or the logo is less than --min-margin
(default 0.04) from an edge, the logo bottom is less than --min-logo-gap (default 0.03) above the text top, or
--min-clear is set under 0.03. Take --logo-width and --logo-top from the kit placement on every ad of a brand.
--footnote sets the claim's source line at the bottom (--footnote-align, --footnote-y) and stops when that line
would sit on an object or a shadow edge.

One tone under the words (owner, 21-11-2026: a white and yellow backdrop split cut "Chocolate" and "so"): the script
stops when a sharp colour or shadow edge runs straight down through a line of words, or across the words (between the
lines too). A smooth light fall-off and photo grain are not an edge. Move --area onto one tone, or render the backdrop
under the words as one tone.
"""
import argparse
import math
import os
import re
import sys
import unicodedata
import urllib.parse
import urllib.request

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

FORMATS = ["JPEG", "PNG", "WEBP"]
MAX_LINES = 3
FOOT_MARGIN = 0.025  # the footnote is small: it may sit closer to the bottom edge than --min-margin (owner, 20-11-2026, the mirror ad)
GOOGLE_CSS = "https://fonts.googleapis.com/css2?family={family}:wght@{wght}"
FONT_HOST = "fonts.gstatic.com"
FONT_MAGIC = (b"\x00\x01\x00\x00", b"true", b"OTTO")


def google_font(family, wght, cache):
    """The family at this weight from Google Fonts, kept in cache. None when it cannot be found."""
    w = int(round(wght or 400))
    name = re.sub(r"[^A-Za-z0-9]+", "-", family).strip("-").lower()
    path = os.path.join(cache, f"{name}-{w}.ttf")
    if os.path.isfile(path):
        return path
    url = GOOGLE_CSS.format(family=urllib.parse.quote_plus(family.strip()), wght=w)
    try:
        # No browser user agent, so the CSS names a TrueType file.
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "a11-headline"}), timeout=20) as r:
            css = r.read().decode("utf-8", "replace")
        m = re.search(r"src:\s*url\((https://[^)]+)\)", css)
        if not m or urllib.parse.urlparse(m.group(1)).hostname != FONT_HOST:
            return None
        with urllib.request.urlopen(m.group(1), timeout=30) as r:
            data = r.read()
    except (OSError, ValueError):
        return None  # not on Google Fonts (HTTP 400), not at this weight, or no network
    if not data.startswith(FONT_MAGIC):
        return None
    os.makedirs(cache, exist_ok=True)
    with open(path, "wb") as f:
        f.write(data)
    return path


def resolve(file, family, fallback, wght, cache, what):
    """A font file path, and a note when the fallback family was used."""
    if file:
        if not os.path.isfile(file):
            sys.exit(f"font file not found: {file}")
        return file, None
    path = google_font(family, wght, cache)
    if path:
        return path, None
    if fallback:
        path = google_font(fallback, wght, cache)
        if path:
            return path, f"FALLBACK: the {what} font {family!r} was not found on Google Fonts; it is set in {fallback!r}. Tell the owner before he judges the type."
    sys.exit(f"the {what} font {family!r} (weight {int(round(wght or 400))}) is not on Google Fonts or cannot be downloaded: download the file the brand's own site serves (its @font-face url) and give it with --font, or give --fallback")


def load_font(path, size, wght):
    font = ImageFont.truetype(path, size)
    if wght is not None:
        try:
            axes = font.get_variation_axes()
        except OSError:
            return font  # not a variable font: the file's own weight
        font.set_variation_by_axes([wght if a.get("name") in (b"Weight", "Weight") else a["default"] for a in axes])
    return font


def non_latin(text):
    """The first letter that is not Latin script, or None. Wrapping is by spaces and Pillow gets no
    direction or shaping, so right-to-left, CJK and other complex scripts are not supported yet."""
    for ch in text:
        # NFKD maps compatibility letters such as º and ª to their Latin base letter.
        if unicodedata.category(ch).startswith("L") and not any("LATIN" in unicodedata.name(b, "") for b in unicodedata.normalize("NFKD", ch)):
            return ch
    return None


def wrap(draw, words, font, width):
    """Greedy wrap; None when one word alone is wider than the box. A "|" word forces a line break."""
    lines, cur = [], ""
    for w in words:
        if w == "|":
            if cur:
                lines.append(cur)
            cur = ""
            continue
        test = f"{cur} {w}".strip()
        if draw.textlength(test, font=font) <= width:
            cur = test
        elif not cur or draw.textlength(w, font=font) > width:
            return None
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def cap_height(font, line="H"):
    """Height above the baseline of the tallest glyph of the line (at least a capital H), in pixels: an accented
    capital such as É reaches higher than H, so the block is measured from the real top of its first line."""
    return max(-font.getbbox("H", anchor="ls")[1], -font.getbbox(line, anchor="ls")[1])


def stub(lines):
    """True when a line of a stacked headline is one short word ("FOR", "A"): a stub line reads as a mistake."""
    return len(lines) > 1 and any(len(re.sub(r"[^\w$]", "", ln)) <= 3 and " " not in ln for ln in lines)


def layout(draw, path, sub_path, headline, subline, box_w, box_h, wght, sub_wght, sub_ratio, gap, leading=1.05, caps=False):
    """The largest size that fits: (head font, head lines, sub font, sub lines, line height, sub height).
    With caps, the block is measured from the top of the capitals (no space is kept for accents or ascenders).
    A size whose wrap leaves a stub line is skipped when a smaller size avoids it."""
    for avoid_stub in (True, False):
        fit = _layout(draw, path, sub_path, headline, subline, box_w, box_h, wght, sub_wght, sub_ratio, gap, leading, caps, avoid_stub)
        if fit:
            return fit
    return None


def _layout(draw, path, sub_path, headline, subline, box_w, box_h, wght, sub_wght, sub_ratio, gap, leading, caps, avoid_stub):
    for size in range(int(box_h), 7, -1):
        hf = load_font(path, size, wght)
        hl = wrap(draw, headline.split(), hf, box_w)
        if not hl or len(hl) > MAX_LINES or (avoid_stub and stub(hl)):
            continue
        lh = int(size * leading)
        first = cap_height(hf, hl[0]) if caps else lh
        total, sf, sl, sh = first + lh * (len(hl) - 1), None, [], 0
        if subline:
            sf = load_font(sub_path, max(8, int(size * sub_ratio)), sub_wght)
            sl = wrap(draw, subline.split(), sf, box_w)
            if not sl or len(sl) > 2:
                continue
            sh = int(sf.size * 1.2)
            total += int(size * gap) + sh * len(sl)
        if total <= box_h:
            return hf, hl, sf, sl, lh, sh
    return None


def body_centre(logo):
    """The x of the logo's visual centre: a small mark set apart at its right top (a TM or R sign) is left out,
    or a centred logo leans left by half that mark's width."""
    a = logo.getchannel("A").point(lambda v: 255 if v > 20 else 0)
    w, h = a.size
    px = a.load()
    rows = []  # per column: the (top, bottom) of its ink, or None
    for x in range(w):
        ys = [y for y in range(h) if px[x, y]]
        rows.append((ys[0], ys[-1]) if ys else None)
    runs, start = [], None
    for x, r in enumerate(rows + [None]):
        if r and start is None:
            start = x
        elif not r and start is not None:
            runs.append((start, x - 1))
            start = None
    if not runs:
        return w / 2
    keep = len(runs)
    while keep > 1:  # drop small, short runs at the right end while together they stay narrow
        x0, x1 = runs[keep - 1]
        bottom = max(rows[x][1] for x in range(x0, x1 + 1))
        tall = bottom - min(rows[x][0] for x in range(x0, x1 + 1)) + 1
        # a TM or R sits high; a trailing full stop or a low small glyph is part of the wordmark and stays
        if bottom > 0.5 * h or tall > 0.35 * h or runs[len(runs) - 1][1] - x0 + 1 > 0.1 * w:
            break
        keep -= 1
    return (runs[0][0] + runs[keep - 1][1] + 1) / 2


def busy_share(im, box):
    """The share of pixels in box (x0, y0, x1, y1) with fine detail: an object edge or texture, not a smooth backdrop or light fall-off."""
    s = im.height / 1280
    crop = im.convert("L").crop((max(0, box[0] - 60), max(0, box[1] - 60), min(im.width, box[2] + 60), min(im.height, box[3] + 60)))
    fine, wide = crop.filter(ImageFilter.GaussianBlur(2 * s)), crop.filter(ImageFilter.GaussianBlur(20 * s))
    ox, oy = box[0] - max(0, box[0] - 60), box[1] - max(0, box[1] - 60)
    w, h = box[2] - box[0], box[3] - box[1]
    fp, wp = fine.load(), wide.load()
    n = sum(1 for y in range(oy, oy + h) for x in range(ox, ox + w) if abs(fp[x, y] - wp[x, y]) > 12)
    return n / max(1, w * h)


SPLIT_STEP = 40  # the colour step (largest channel difference) across a few pixels that counts as a sharp edge
SPLIT_SHARE = 0.6  # an edge that runs along this share of a word box cuts the words


def split_edge(im, box, vertical):
    """Where a sharp colour or shadow edge runs straight through box (x0, y0, x1, y1), as a pixel column (vertical) or
    row, or None (owner, 21-11-2026: a white and yellow backdrop split cut "Chocolate"). A smooth light fall-off is no edge."""
    s = im.height / 1280
    k = max(2, round(4 * s))
    x0, y0, x1, y1 = box
    if vertical:
        x0, x1 = max(0, x0 - k), min(im.width, x1 + k)
    else:
        y0, y1 = max(0, y0 - k), min(im.height, y1 + k)
    x0, y0, x1, y1 = max(0, x0), max(0, y0), min(im.width, x1), min(im.height, y1)
    region = im.crop((x0, y0, x1, y1)).filter(ImageFilter.GaussianBlur(1.5 * s))
    w, h = region.size
    if (w if vertical else h) <= k or min(w, h) < 2:
        return None
    a = region.crop((k, 0, w, h) if vertical else (0, k, w, h))
    b = region.crop((0, 0, w - k, h) if vertical else (0, 0, w, h - k))
    r, g, bl = ImageChops.difference(a, b).split()
    step = ImageChops.lighter(ImageChops.lighter(r, g), bl).point(lambda v: 1 if v > SPLIT_STEP else 0)
    data, sw, sh = step.tobytes(), step.width, step.height
    if vertical:  # a column where most rows step: a vertical edge
        best, at = max((sum(data[x::sw]) / sh, x) for x in range(sw))
        return x0 + at + k // 2 if best >= SPLIT_SHARE else None
    best, at = max((sum(data[y * sw:(y + 1) * sw]) / sw, y) for y in range(sh))
    return y0 + at + k // 2 if best >= SPLIT_SHARE else None


def foot(im, a, font_path, color, left, right):
    """The footnote: small, 80% opacity, at the bottom, and only on plain backdrop (owner, 20-11-2026: a prop's handle covered "analysis")."""
    if not (0 < a.footnote_size < 0.05 and 0 < a.footnote_y < 1):
        sys.exit("--footnote-size must be more than 0 and less than 0.05, --footnote-y inside the picture")
    W, H = im.size
    f = load_font(font_path, max(8, round(H * a.footnote_size)), None)
    d = ImageDraw.Draw(im)
    b = d.textbbox((0, 0), a.footnote, font=f)
    tw, th = b[2] - b[0], b[3] - b[1]
    x = left - b[0] if a.footnote_align == "left" else right - tw - b[0]
    y = round(H * a.footnote_y) - th // 2 - b[1]
    if x + b[0] < 0 or x + b[2] > W:
        sys.exit("the footnote is wider than the text area allows: shorten it or widen the area")
    if (y + b[3]) > H * (1 - FOOT_MARGIN):
        sys.exit(f"the footnote ends less than {100 * FOOT_MARGIN:.1f}% above the bottom edge: raise --footnote-y")
    pad = round(0.4 * f.size)
    box = (int(x + b[0]), int(y + b[1] - pad), int(x + b[2]), int(y + b[3] + pad))
    share = busy_share(im, box)
    if share > 0.08:
        other = "right" if a.footnote_align == "left" else "left"
        sys.exit(f"the footnote would sit on an object or a shadow edge ({100 * share:.0f}% of its box has detail, more than 8%): try --footnote-align {other} or move --footnote-y")
    layer = Image.new("RGBA", im.size, (0, 0, 0, 0))
    ImageDraw.Draw(layer).text((x, y), a.footnote, font=f, fill=color + (round(255 * 0.8),))
    im.paste(Image.alpha_composite(im.convert("RGBA"), layer).convert("RGB"))


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    p.add_argument("--in", dest="src", required=True)
    p.add_argument("--out", required=True)
    font = p.add_mutually_exclusive_group(required=True)
    font.add_argument("--family", help="the brand kit's font name, from Google Fonts")
    font.add_argument("--font", help="a font file (a brand font that is not on Google Fonts)")
    p.add_argument("--fallback", help="a Google Fonts family used only when --family cannot be found")
    sub = p.add_mutually_exclusive_group()
    sub.add_argument("--sub-family")
    sub.add_argument("--sub-font")
    p.add_argument("--cache", default=os.path.join(os.path.expanduser("~"), ".cache", "a11-fonts"))
    p.add_argument("--headline", required=True)
    p.add_argument("--subline", default="")
    p.add_argument("--area", required=True, help="x0,y0,x1,y1 as fractions")
    p.add_argument("--wght", type=float)
    p.add_argument("--sub-wght", type=float)
    p.add_argument("--sub-ratio", type=float, default=0.42)
    p.add_argument("--gap", type=float, default=0.25, help="space above the subline, x headline size")
    p.add_argument("--color", default="000000")
    p.add_argument("--align", choices=["left", "right", "center"], default="left")
    p.add_argument("--case", choices=["asis", "upper"], default="asis", help="upper: the headline in capitals")
    p.add_argument("--sub-case", choices=["asis", "upper"], default="asis", help="upper: the subline in capitals")
    p.add_argument("--leading", type=float, default=1.05, help="step between headline lines, x the font size")
    p.add_argument("--accent", default="", help="headline words set in --accent-color (matched without case)")
    p.add_argument("--accent-color", default="", help="the kit's accent colour, hex")
    p.add_argument("--min-head", type=float, default=0, help="stop when the headline size is under this share of the picture height (engine 3: 0.07)")
    p.add_argument("--product-top", type=float, default=None, help="the product's top edge, x the picture height: the text must end --min-clear above it")
    p.add_argument("--min-clear", type=float, default=0.04, help="clear space between the text and --product-top, x the picture height")
    p.add_argument("--logo", help="the kit logo (PNG), drawn above the words: a preview on drafts, the real logo on a final built in code (creative-playbook 7.7)")
    p.add_argument("--logo-width", type=float, default=0.25, help="logo width, x the picture width")
    p.add_argument("--logo-top", type=float, default=0.045, help="logo top, x the picture height")
    p.add_argument("--min-margin", type=float, default=0.04, help="breathing space (owner, 20-11-2026): the text area, the logo and the footnote stay at least this share of the width (sides) or height (top, bottom) from the picture edge")
    p.add_argument("--min-logo-gap", type=float, default=0.03, help="clear space between the logo bottom and the text top, x the picture height")
    p.add_argument("--footnote", default="", help="a small source line at the bottom (the claim's study), set in the subline font at --footnote-size, 80%% opacity")
    p.add_argument("--footnote-size", type=float, default=0.0175, help="footnote size, x the picture height")
    p.add_argument("--footnote-align", choices=["left", "right"], default="left", help="left: starts at the area's left edge; right: ends at the area's right edge")
    p.add_argument("--footnote-y", type=float, default=0.945, help="footnote centre, x the picture height")
    p.add_argument("--logo-x", type=float, default=None, help="logo left edge, x the picture width (default: centred); e.g. the text column's left edge, so the logo heads the words")
    a = p.parse_args(argv)

    a.headline = a.headline.replace("|", " | ")
    if not a.headline.replace("|", "").strip():
        sys.exit("the headline is empty")
    bad = non_latin(a.headline + a.subline + (a.footnote or ""))  # the footnote too: a missing glyph draws a box
    if bad:
        sys.exit(f"only Latin-script words are supported (found {bad!r}): set non-Latin or right-to-left copy another way and tell the owner")
    if not (math.isfinite(a.gap) and a.gap >= 0 and math.isfinite(a.sub_ratio) and a.sub_ratio > 0):
        sys.exit("--gap must be 0 or more and --sub-ratio more than 0")
    if not (math.isfinite(a.leading) and 0.8 <= a.leading <= 2):
        sys.exit("--leading must be from 0.8 to 2")
    if a.case == "upper":
        a.headline = a.headline.upper()
    if a.sub_case == "upper":
        a.subline = a.subline.upper()
    accent = {w.casefold() for w in a.accent.split()}
    if accent and not a.accent_color:
        sys.exit("--accent needs --accent-color")
    missing = accent - {w.casefold() for w in a.headline.split() if w != "|"}
    if missing:
        sys.exit(f"--accent words not in the headline: {' '.join(sorted(missing))}")
    try:
        x0, y0, x1, y1 = (float(v) for v in a.area.split(","))
    except ValueError:
        sys.exit(f"--area must be x0,y0,x1,y1, got {a.area!r}")
    if not (0 <= x0 < x1 <= 1 and 0 <= y0 < y1 <= 1):
        sys.exit(f"--area {a.area} is not inside the picture (0 <= x0 < x1 <= 1, 0 <= y0 < y1 <= 1)")
    try:
        color = tuple(int(a.color.lstrip("#")[i:i + 2], 16) for i in (0, 2, 4))
    except ValueError:
        sys.exit(f"--color must be a hex colour such as 000000, got {a.color!r}")
    if accent and not re.fullmatch(r"#?[0-9A-Fa-f]{6}", a.accent_color):
        sys.exit(f"--accent-color must be a hex colour such as DD4430, got {a.accent_color!r}")
    accent_color = tuple(int(a.accent_color.lstrip("#")[i:i + 2], 16) for i in (0, 2, 4)) if accent else color

    head_path, note = resolve(a.font, a.family, a.fallback, a.wght, a.cache, "headline")
    if a.sub_font or a.sub_family:
        sub_path, sub_note = resolve(a.sub_font, a.sub_family, a.fallback, a.sub_wght, a.cache, "subline")
    elif a.family and a.subline:
        sub_path, sub_note = resolve(None, a.family, a.fallback, a.sub_wght, a.cache, "subline")  # the same family at the subline weight
    else:
        sub_path, sub_note = head_path, None

    try:
        im = Image.open(a.src, formats=FORMATS).convert("RGB")
    except OSError as e:
        sys.exit(f"cannot read the picture {a.src}: {e}")
    W, H = im.size
    bx0, by0, bw, bh = x0 * W, y0 * H, (x1 - x0) * W, (y1 - y0) * H
    draw = ImageDraw.Draw(im)
    caps = a.case == "upper"
    fit = layout(draw, head_path, sub_path, a.headline, a.subline, bw, bh, a.wght, a.sub_wght, a.sub_ratio, a.gap, a.leading, caps)
    if fit is None:
        sys.exit(f"the words do not fit the area {a.area} in at most {MAX_LINES} headline lines and 2 subline lines; make the area larger or the copy shorter")
    hf, hl, sf, sl, lh, sh = fit
    if not (0 <= a.min_head < 1 and 0 <= a.min_clear < 1) or (a.product_top is not None and not 0 < a.product_top <= 1):
        sys.exit("--min-head and --min-clear must be from 0 to less than 1, --product-top more than 0 and at most 1")
    m = a.min_margin
    if not (0 <= m < 0.25 and 0 <= a.min_logo_gap < 0.25):
        sys.exit("--min-margin and --min-logo-gap must be from 0 to less than 0.25")
    if x0 < m or x1 > 1 - m:
        sys.exit(f"the area {a.area} leaves less than {100 * m:.0f}% of the width at a side: keep x0 >= {m} and x1 <= {1 - m:.2f} (breathing space, --min-margin)")
    if y0 < m:
        sys.exit(f"the area starts {100 * y0:.1f}% from the top, less than --min-margin {100 * m:.0f}%")
    if a.product_top is not None and a.min_clear < 0.03:
        sys.exit("--min-clear under 0.03 leaves the words too close to the product (owner, 20-11-2026: the words need breathing space)")
    if hf.size < a.min_head * H:
        sys.exit(f"the headline is {hf.size}px, {100 * hf.size / H:.1f}% of the height, under --min-head {100 * a.min_head:.1f}%: make the area larger or break the lines with ' | '")

    ink = [0]  # the lowest drawn pixel row: descenders and marks such as a cedilla count (the --product-top check)
    boxes = []  # each drawn line's ink box (the split check)
    src = im.copy()  # the backdrop under the words, before any drawing

    def put(lines, font, step, y, anchor="la", marked=frozenset()):
        for line in lines:
            w = draw.textlength(line, font=font)
            ink[0] = max(ink[0], draw.textbbox((0, y), line, font=font, anchor=anchor)[3])
            x = bx0 if a.align == "left" else bx0 + bw - w if a.align == "right" else bx0 + (bw - w) / 2
            boxes.append(draw.textbbox((x, y), line, font=font, anchor=anchor))
            if marked:  # word by word, so the accent words take their own colour; the spaces keep the line's own width
                words = line.split(" ")
                for i, word in enumerate(words):
                    draw.text((x, y), word, font=font, fill=accent_color if word.casefold() in marked else color, anchor=anchor)
                    x += draw.textlength(word + (" " if i < len(words) - 1 else ""), font=font)
            else:
                draw.text((x, y), line, font=font, fill=color, anchor=anchor)
            y += step
        return y

    top = by0
    logo = None
    if a.logo:  # checked before any drawing: a logo that reaches the text stops the script
        if not (0 < a.logo_width <= 1 and 0 <= a.logo_top < 1):
            sys.exit("--logo-width must be more than 0 and at most 1, --logo-top from 0 to less than 1")
        if a.logo_x is not None and not (math.isfinite(a.logo_x) and 0 <= a.logo_x and a.logo_x + a.logo_width <= 1):
            sys.exit("--logo-x must be 0 or more, with the logo inside the picture (logo-x + logo-width <= 1)")
        try:
            logo = Image.open(a.logo, formats=["PNG"]).convert("RGBA")
        except OSError as e:
            sys.exit(f"cannot read the logo {a.logo}: {e}")
        if logo.getbbox():
            logo = logo.crop(logo.getbbox())  # trim a transparent border, as compose_final does
        lw = max(1, int(W * a.logo_width))
        logo = logo.resize((lw, max(1, round(logo.height * lw / logo.width))), Image.LANCZOS)
        ly = int(H * a.logo_top)
        lx = round(W / 2 - body_centre(logo)) if a.logo_x is None else round(W * a.logo_x)
        if a.logo_top < m or lx < m * W or lx + logo.width > (1 - m) * W:
            sys.exit(f"the logo is less than --min-margin {100 * m:.0f}% from the picture edge: use the kit placement (--logo-top) and the text column's left edge (--logo-x)")
        if ly + logo.height > top:
            sys.exit(f"the logo bottom ({100 * (ly + logo.height) / H:.1f}%) is under the text top ({100 * top / H:.1f}%): move the area down or make the logo smaller")
        if ly + logo.height + a.min_logo_gap * H > top:
            sys.exit(f"the gap between the logo bottom ({100 * (ly + logo.height) / H:.1f}%) and the text top ({100 * top / H:.1f}%) is under --min-logo-gap {100 * a.min_logo_gap:.0f}%: move the area down; keep the logo at the kit size")
    if caps:  # baselines: the first one a cap height under the area top
        y = put(hl, hf, lh, top + cap_height(hf, hl[0]), "ls", accent) - lh
    else:
        y = put(hl, hf, lh, top, "la", accent)
    if sl:
        y = put(sl, sf, sh, y + int(hf.size * a.gap))
    if a.product_top is not None and ink[0] + a.min_clear * H > a.product_top * H:
        sys.exit(f"the text ends at {100 * ink[0] / H:.1f}% of the height, less than {100 * a.min_clear:.1f}% above the product top ({100 * a.product_top:.1f}%): move the area up or make it shorter")
    if ink[0] > (1 - m) * H:
        sys.exit(f"the text ends at {100 * ink[0] / H:.1f}% of the height, less than --min-margin {100 * m:.0f}% above the bottom edge: move the area up or make it shorter")
    # One tone under the words (owner, 21-11-2026): no sharp backdrop edge runs through a line, or between the lines.
    pad = max(2, round(0.008 * H))
    for b in boxes:
        b = (int(b[0]) - pad, int(b[1]) - pad, int(b[2]) + pad, int(b[3]) + pad)
        at = split_edge(src, b, vertical=True)
        if at is not None:
            sys.exit(f"a sharp colour or shadow edge runs down through the words at {100 * at / W:.1f}% of the width: move --area so every word sits on one tone of the backdrop, or render the backdrop under the words as one tone")
    if boxes:
        union = (min(int(b[0]) for b in boxes) - pad, min(int(b[1]) for b in boxes) - pad, max(int(b[2]) for b in boxes) + pad, max(int(b[3]) for b in boxes) + pad)
        at = split_edge(src, union, vertical=False)
        if at is not None:
            sys.exit(f"a sharp colour or shadow edge runs across the words at {100 * at / H:.1f}% of the height: move --area so every word sits on one tone of the backdrop, or render the backdrop under the words as one tone")
    if a.footnote:
        foot(im, a, sub_path, color, bx0, bx0 + bw)
    if logo:
        im.paste(logo, (lx, ly), logo)
    im.save(a.out, quality=95)
    for n in (note, sub_note):
        if n:
            print(n)
    print(f"{a.out}: headline {hf.size}px in {len(hl)} line(s), subline {sf.size if sf else 0}px; text top {100 * top / H:.1f}% bottom {100 * y / H:.1f}% of the height")


if __name__ == "__main__":
    main()
