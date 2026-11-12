"""Input checks of the Python scripts, on synthetic pictures. Run: python3 -m unittest discover -s scripts -p "test_*.py"

Needs Python 3.12 or newer and the packages in scripts/requirements.txt. No real photo, no network. CI runs it (.github/workflows/check.yml).
"""
import contextlib
import importlib.util
import io
import os
import shutil
import sys
import tempfile
import types
import unittest

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))


def load(name):
    spec = importlib.util.spec_from_file_location(name, os.path.join(HERE, f"{name}.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


box_print = load("box_print")
product_lock = load("product_lock")
food_grade = load("food_grade")
headline = load("headline")


def exit_message(fn, *args):
    """The message of the sys.exit that fn raises."""
    with contextlib.redirect_stdout(io.StringIO()):
        try:
            fn(*args)
        except SystemExit as e:
            return str(e.code)
    raise AssertionError("no sys.exit")


class Tmp(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()

    def tearDown(self):
        self.dir.cleanup()

    def save(self, name, arr):
        path = os.path.join(self.dir.name, name)
        Image.fromarray(arr.astype("uint8")).save(path)
        return path


class BoxPrint(Tmp):
    def packshot(self):
        """A light 200x120 card with three dark bars (the print) in the block 40,40,160,80."""
        a = np.full((120, 200, 3), 230, np.uint8)
        for x in (50, 90, 130):
            a[50:70, x:x + 8] = 30
        return self.save("pack.png", a)

    def box(self, **block):
        return box_print.Box({"packshot": self.packshot(), "face": [0, 0, 200, 120], "blocks": [{"box": [40, 40, 160, 80], **block}]})

    def test_xmin_left_of_the_crop_cuts_nothing(self):
        # P1: the crop starts at x 28 (40 - 12). An xmin of 5 is left of it and must keep the whole block.
        plain, _ = self.box().ink_alpha(0)
        cut, _ = self.box(xmin=5).ink_alpha(0)
        self.assertGreater(plain.sum(), 0)
        np.testing.assert_allclose(cut, plain)

    def test_a_band_outside_the_block_stops_with_a_clear_message(self):
        # P2: a band far outside the block leaves an empty mask.
        msg = exit_message(self.box(band=[[1000, 1000], [1100, 1000], 3]).ink_alpha, 0)
        self.assertIn("leaves no part of the block box", msg)

    def test_a_band_only_in_the_crop_padding_stops_with_a_clear_message(self):
        # The crop has 12 px of padding around the box; a band at y 30 (above the box top at 40) touches only that padding.
        msg = exit_message(self.box(band=[[40, 30], [160, 30], 3]).ink_alpha, 0)
        self.assertIn("leaves no part of the block box", msg)

    def test_an_xmin_right_of_the_block_stops_with_a_clear_message(self):
        msg = exit_message(self.box(xmin=500).ink_alpha, 0)
        self.assertIn("leaves no part of the block box", msg)

    def test_a_weak_local_fit_is_reported(self):
        # P3: two flat pictures give no fit (ECC fails or scores 0): the script must say so.
        flat = np.full((120, 200), 200, np.float32)
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            H = box_print.refine(np.eye(3), [40, 40, 160, 80], flat, flat)
        self.assertIn("WARNING: block [40, 40, 160, 80]: the local fit is weak", out.getvalue())
        self.assertEqual(H.shape, (3, 3))


class ProductLock(Tmp):
    def setUp(self):
        super().setUp()
        self.pack = self.save("pack.png", np.full((100, 80, 3), 128))

    def args(self, box):
        return types.SimpleNamespace(packshot=self.pack, scene=self.pack, size="400,500", box=box)

    def test_skeleton_refuses_a_box_past_the_edge(self):
        # P4: x1 90 is past the 80 px width.
        self.assertIn("is outside the packshot (80x100)", exit_message(product_lock.skeleton, self.args("10,10,90,50")))

    def test_skeleton_refuses_a_box_with_no_height(self):
        # P4: y1 = y0 divided by zero.
        self.assertIn("not x0<x1, y0<y1", exit_message(product_lock.skeleton, self.args("10,40,50,40")))

    def test_swap_refuses_a_box_past_the_edge(self):
        self.assertIn("is outside the packshot (80x100)", exit_message(product_lock.swap, self.args("10,10,50,120")))

    def test_a_box_inside_the_packshot_passes(self):
        product_lock.check_box((0, 0, 80, 100), (80, 100))

    def test_a_packshot_in_another_format_is_refused(self):
        # Only JPEG, PNG and WEBP open; a GIF named .png is still refused.
        path = os.path.join(self.dir.name, "fake.png")
        Image.fromarray(np.full((100, 80, 3), 128, np.uint8)).save(path, format="GIF")
        a = self.args("10,10,50,50")
        a.packshot = path
        with self.assertRaises(Image.UnidentifiedImageError):
            product_lock.skeleton(a)


class FoodGrade(unittest.TestCase):
    def picture(self):
        """A pale backdrop (240,235,225) with orange 'kernels' at x 0 to 40: the food touches the left edge."""
        a = np.full((60, 120, 3), (240, 235, 225), float)
        a[10:50, 0:40] = (200, 120, 40)
        return Image.fromarray(a.astype("uint8"))

    def ref(self):
        return Image.fromarray(np.full((40, 40, 3), (210, 140, 50), np.uint8))

    def test_a_region_at_the_left_edge_samples_the_backdrop_at_its_right(self):
        # P5: X0 = 0 used to give an empty or wrapped slice, so a wrong backdrop and a wrong mask.
        src = self.picture()
        out, _ = food_grade.grade(src, [(0, 10, 40, 50)], self.ref(), (0, 0, 40, 40))
        a, b = np.asarray(src).astype(int), np.asarray(out).astype(int)
        want = np.array([210, 140, 50])  # the reference kernels
        before = np.abs(a[20:40, 5:35] - want).sum(axis=-1).mean()
        after = np.abs(b[20:40, 5:35] - want).sum(axis=-1).mean()
        self.assertLess(after, before / 2)  # the kernels moved toward the reference
        np.testing.assert_array_equal(b[:, 60:], a[:, 60:])  # the backdrop beside them did not change

    def test_a_region_outside_the_picture_is_refused(self):
        with self.assertRaisesRegex(ValueError, r"region \(100, 10, 140, 50\) is outside the packshot \(120x60\)"):
            food_grade.grade(self.picture(), [(100, 10, 140, 50)], self.ref(), (0, 0, 40, 40))

    def test_a_region_as_wide_as_the_picture_is_refused(self):
        with self.assertRaisesRegex(ValueError, "leaves no backdrop to sample"):
            food_grade.grade(self.picture(), [(0, 10, 120, 50)], self.ref(), (0, 0, 40, 40))

    def test_a_ref_box_outside_the_close_up_is_refused(self):
        with self.assertRaisesRegex(ValueError, r"ref_box \(0, 0, 80, 40\) is outside the close-up \(40x40\)"):
            food_grade.grade(self.picture(), [(0, 10, 40, 50)], self.ref(), (0, 0, 80, 40))


FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"


@unittest.skipUnless(os.path.isfile(FONT), "needs DejaVu Sans (on the Ubuntu CI runner)")
class Headline(Tmp):
    # DejaVu Sans ships with Ubuntu (the CI runner) and this session; any TrueType file works.
    FONT = FONT

    def run_(self, *extra):
        src = self.save("in.png", np.full((500, 400, 3), 220))
        out = os.path.join(self.dir.name, "out.jpg")
        with contextlib.redirect_stdout(io.StringIO()) as buf:
            headline.main(["--in", src, "--out", out, *extra])
        return out, buf.getvalue()

    def test_the_words_are_set_inside_the_area(self):
        out, msg = self.run_("--font", self.FONT, "--headline", "Ten flavours, one cake.", "--subline", "Every slice differs.", "--area", "0.5,0.2,0.95,0.5")
        a = np.asarray(Image.open(out).convert("L"))
        ys, xs = np.where(a < 100)
        self.assertTrue(len(xs) > 0, "no text was drawn")
        self.assertGreaterEqual(xs.min(), 0.5 * 400 - 2)
        self.assertLessEqual(xs.max(), 0.95 * 400 + 2)
        self.assertGreaterEqual(ys.min(), 0.2 * 500 - 2)
        self.assertLessEqual(ys.max(), 0.5 * 500 + 2)
        self.assertIn("text top 20.0%", msg)

    def test_a_missing_font_stops_with_a_clear_message(self):
        self.assertIn("font file not found", exit_message(self.run_, "--font", "/no/such.ttf", "--headline", "Hi", "--area", "0,0,1,1"))

    def test_an_area_outside_the_picture_is_refused(self):
        self.assertIn("is not inside the picture", exit_message(self.run_, "--font", self.FONT, "--headline", "Hi", "--area", "0.5,0.2,1.2,0.5"))

    def test_words_that_cannot_fit_stop_with_a_clear_message(self):
        self.assertIn("do not fit", exit_message(self.run_, "--font", self.FONT, "--headline", "Supercalifragilisticexpialidocious", "--area", "0.9,0.1,0.95,0.12"))

    def family_run(self, *extra):
        # The kit font comes from a cache; a fetch would fail (no network in the tests).
        cache = os.path.join(self.dir.name, "fonts")
        os.makedirs(cache, exist_ok=True)
        shutil.copy(self.FONT, os.path.join(cache, "dejavu-sans-600.ttf"))
        old, headline.GOOGLE_CSS = headline.GOOGLE_CSS, "file:///no/such/{family}-{wght}.css"
        try:
            return self.run_("--cache", cache, "--wght", "600", "--headline", "Ten flavours.", "--area", "0.1,0.2,0.9,0.5", *extra)
        finally:
            headline.GOOGLE_CSS = old

    def test_the_kit_font_family_is_used_by_name(self):
        out, msg = self.family_run("--family", "DejaVu Sans")
        self.assertIn("headline", msg)
        self.assertNotIn("FALLBACK", msg)

    def test_a_family_that_cannot_be_found_stops_with_a_clear_message(self):
        self.assertIn("is not on Google Fonts", exit_message(self.family_run, "--family", "No Such Brand Font"))

    def test_non_latin_words_are_refused(self):
        self.assertIn("only Latin-script", exit_message(self.run_, "--font", self.FONT, "--headline", "十种口味", "--area", "0,0,1,1"))
        self.assertIsNone(headline.non_latin("Crème brûlée, 1º lugar"))

    def test_a_negative_gap_is_refused(self):
        self.assertIn("--gap must be 0 or more", exit_message(self.run_, "--font", self.FONT, "--headline", "Hi", "--area", "0,0,1,1", "--gap", "-1"))

    def test_a_missing_picture_stops_with_a_clear_message(self):
        out = os.path.join(self.dir.name, "o.jpg")
        self.assertIn("cannot read the picture", exit_message(headline.main, ["--in", "/no/such.jpg", "--out", out, "--font", self.FONT, "--headline", "Hi", "--area", "0,0,1,1"]))

    def test_the_fallback_family_is_used_and_named(self):
        out, msg = self.family_run("--family", "No Such Brand Font", "--fallback", "DejaVu Sans")
        self.assertIn("FALLBACK: the headline font 'No Such Brand Font'", msg)


if __name__ == "__main__":
    sys.exit(unittest.main())
