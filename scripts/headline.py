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
"""
import argparse
import math
import os
import re
import sys
import unicodedata
import urllib.parse
import urllib.request

from PIL import Image, ImageDraw, ImageFont

FORMATS = ["JPEG", "PNG", "WEBP"]
MAX_LINES = 3
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
    p.add_argument("--logo", help="drafts only: the kit logo (PNG) drawn at the top centre as a preview; compose_final places the real one on finals")
    p.add_argument("--logo-width", type=float, default=0.25, help="logo width, x the picture width")
    p.add_argument("--logo-top", type=float, default=0.045, help="logo top, x the picture height")
    a = p.parse_args(argv)

    a.headline = a.headline.replace("|", " | ")
    if not a.headline.replace("|", "").strip():
        sys.exit("the headline is empty")
    bad = non_latin(a.headline + a.subline)
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

    def put(lines, font, step, y, anchor="la", marked=frozenset()):
        for line in lines:
            w = draw.textlength(line, font=font)
            x = bx0 if a.align == "left" else bx0 + bw - w if a.align == "right" else bx0 + (bw - w) / 2
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
        try:
            logo = Image.open(a.logo, formats=["PNG"]).convert("RGBA")
        except OSError as e:
            sys.exit(f"cannot read the logo {a.logo}: {e}")
        lw = max(1, int(W * a.logo_width))
        logo = logo.resize((lw, max(1, round(logo.height * lw / logo.width))), Image.LANCZOS)
        ly = int(H * a.logo_top)
        if ly + logo.height > top:
            sys.exit(f"the logo bottom ({100 * (ly + logo.height) / H:.1f}%) is under the text top ({100 * top / H:.1f}%): move the area down or make the logo smaller")
    if caps:  # baselines: the first one a cap height under the area top
        y = put(hl, hf, lh, top + cap_height(hf, hl[0]), "ls", accent) - lh
    else:
        y = put(hl, hf, lh, top, "la", accent)
    if sl:
        y = put(sl, sf, sh, y + int(hf.size * a.gap))
    if logo:
        im.paste(logo, ((W - logo.width) // 2, ly), logo)
    im.save(a.out, quality=95)
    for n in (note, sub_note):
        if n:
            print(n)
    print(f"{a.out}: headline {hf.size}px in {len(hl)} line(s), subline {sf.size if sf else 0}px; text top {100 * top / H:.1f}% bottom {100 * y / H:.1f}% of the height")


if __name__ == "__main__":
    main()
