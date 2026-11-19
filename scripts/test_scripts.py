"""Input checks of the Python scripts, on synthetic pictures. Run: python3 -m unittest discover -s scripts -p "test_*.py"

Needs Python 3.12 or newer and the packages in scripts/requirements.txt. No real photo, no network. CI runs it (.github/workflows/check.yml).
"""
import contextlib
import importlib.util
import io
import os
import re
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
photo_finish = load("photo_finish")
pack_check = load("pack_check")


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

    def test_an_ink_rel_out_of_range_is_refused(self):
        for bad in (0, 1.5, -0.2, float("nan"), "0.8", True):
            self.assertIn("ink_rel must be", exit_message(lambda: self.box(ink_rel=bad)))
        self.box(ink_rel=1)  # the top of the range passes

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


    def test_the_plain_face_next_to_a_pale_backdrop_is_not_cleaned(self):
        # W46 Sonnet run: the face beside the box edge read as print (dark against the backdrop) and was inpainted pale.
        g = np.full((120, 200), 170, np.float32)  # the box face
        g[:, 150:] = 240  # a pale backdrop right of the box edge
        g[58:64, 100:140] = 60  # the render's own print, ending 10 px before the edge
        amap = np.zeros_like(g)
        amap[58:64, 100:140] = 1
        dark, kill = box_print.print_mask(g, [amap])
        self.assertTrue(dark[60, 120] > 0, "the print must be found")
        self.assertEqual(int(kill[75, 146]), 0, "the plain face next to the edge must stay")
        self.assertEqual(int(dark[50, 145]), 0)

    def test_each_block_is_judged_against_its_own_face(self):
        # Two blocks: one on a light face, one on a face in shade. Print in the shaded block is lighter than 0.82 of the
        # light face but darker than 0.82 of its own face, so it must still be found.
        g = np.full((120, 300), 200, np.float32)
        g[:, 150:] = 110  # the face in shade
        g[58:64, 40:100] = 60
        g[58:64, 190:250] = 80
        a1, a2 = np.zeros_like(g), np.zeros_like(g)
        a1[58:64, 40:100] = 1
        a2[58:64, 190:250] = 1
        dark, _ = box_print.print_mask(g, [a1, a2])
        self.assertTrue(dark[60, 70] > 0 and dark[60, 220] > 0)
        dark, _ = box_print.print_mask(g, [a1, a2], [None, 0.5])  # a block's ink_rel overrides the default
        self.assertEqual(int(dark[60, 220]), 0)


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


class LayoutReprint(Tmp):
    """layout places products from a plan; reprint fits the packshot face back onto a render made from it."""

    def setUp(self):
        super().setUp()
        a = np.full((260, 160, 3), 245, np.uint8)        # pale backdrop
        a[20:240, 30:130] = 232                           # the carton (box 30,20,130,240)
        for y in (80, 120, 160):                          # the print: dark bars and a red badge on the face
            a[y:y + 12, 45:115] = 25
        a[200:225, 50:90] = (200, 40, 40)
        self.pack = self.save("pack.png", a)
        self.box, self.face = "30,20,130,240", "34,40,126,236"

    def plan(self, **over):
        import json
        plan = {"size": [400, 500], "bg": "#B4A08C",
                "shapes": [{"rect": [0, 0.8, 1, 1], "fill": "#8C6440"}],
                "products": [{"cx": 0.28, "base": 0.8, "height": 0.4, "side": "up", "rot": -0.5},
                             {"cx": 0.70, "base": 0.8, "height": 0.4, "side": "R", "rot": 1.0}]}
        plan.update(over)
        path = os.path.join(self.dir.name, f"plan{len(os.listdir(self.dir.name))}.json")
        with open(path, "w") as f:
            json.dump(plan, f)
        return path

    def ns(self, **kw):
        base = dict(packshot=self.pack, box=self.box, alpha=None, plan=self.plan(), out=os.path.join(self.dir.name, "out.png"))
        base.update(kw)
        return types.SimpleNamespace(**base)

    def rp(self, render, **kw):
        a = dict(face=self.face, render=render, debug=None, min_score=0.8, search_scale=0.08, search_rot=1.5, search_px=70, light_px=14)
        a.update(kw)
        return self.ns(out=os.path.join(self.dir.name, "rp.png"), **a)

    def test_layout_places_each_product_with_its_side(self):
        with contextlib.redirect_stdout(io.StringIO()):
            product_lock.layout(self.ns())
        sk = np.asarray(Image.open(os.path.join(self.dir.name, "out.png")).convert("L")).astype(int)
        self.assertGreater(sk[272:282, 100:120].mean() - sk[100:150, 15:45].mean(), 50, "the upright carton's pale paper over the backdrop")
        self.assertLess(sk[300:400, 90:140].min(), 60, "the upright carton's dark print bars")
        self.assertGreater(sk[440:460, 10:20].mean(), 80)
        self.assertLess(abs(int(sk[480, 5]) - 0x6a), 25, "the floor shape under the products")

    def test_layout_composes_each_product_from_its_own_photo(self):
        # Owner, 18-11-2026: real slice photos of each flavour, cut out and composed, not model-drawn food.
        red = np.full((120, 100, 3), 255, np.uint8); red[20:100, 20:80] = (200, 30, 40)
        blue = np.full((120, 100, 3), 255, np.uint8); blue[30:90, 10:90] = (40, 50, 190)
        self.save("red.png", red); self.save("blue.png", blue)
        for name, arr in (("red", red), ("blue", blue)):
            m = np.where(arr.min(axis=2) < 250, 255, 0)
            self.save(f"m_{name}.png", m)
        plan = self.plan(products=[
            {"cx": 0.3, "base": 0.8, "height": 0.4, "photo": "red.png", "alpha": "m_red.png"},
            {"cx": 0.75, "base": 0.8, "height": 0.3, "photo": "blue.png", "alpha": "m_blue.png", "blur": 2}])
        with contextlib.redirect_stdout(io.StringIO()) as log:
            product_lock.layout(self.ns(packshot=None, box=None, plan=plan))
        self.assertIn("2 products on 400x500", log.getvalue())
        sk = np.asarray(Image.open(os.path.join(self.dir.name, "out.png")).convert("RGB")).astype(int)
        self.assertGreater(sk[300, 120, 0] - sk[300, 120, 2], 100, "the red item at its place")
        self.assertGreater(sk[340, 300, 2] - sk[340, 300, 0], 100, "the blue item at its place")
        self.assertLess(abs(sk[40, 200] - (0xB4, 0xA0, 0x8C)).max(), 3, "the backdrop shows no white photo backdrop")
        self.assertAlmostEqual(int((sk[:, 120, 0] - sk[:, 120, 2] > 100).sum()), 200, delta=4)  # height 0.4 of 500 px, true shape
        # bad plans stop with clear messages
        bad = self.plan(products=[{"cx": 0.3, "base": 0.8, "height": 0.4, "alpha": "m_red.png"}])
        self.assertIn("go with its own photo", exit_message(product_lock.layout, self.ns(packshot=None, box=None, plan=bad)))
        mixed = self.plan(products=[{"cx": 0.3, "base": 0.8, "height": 0.4}])
        self.assertIn("a photo for every product", exit_message(product_lock.layout, self.ns(packshot=None, box=None, plan=mixed)))
        self.assertIn("their own photos", exit_message(product_lock.reprint, self.rp(self.pack, plan=plan)))

    def test_layout_blurs_an_item_with_a_soft_edge_at_its_place(self):
        # Review of #113: the blur ran inside the piece's own border, so the soft edge stopped in a hard straight line.
        red = np.full((120, 100, 3), 255, np.uint8); red[10:110, 10:90] = (200, 30, 40)
        self.save("red.png", red); self.save("m_red.png", np.where(red.min(axis=2) < 250, 255, 0))
        rows = {}
        for blur in (0, 20):
            item = {"cx": 0.5, "base": 0.8, "height": 0.4, "photo": "red.png", "alpha": "m_red.png", "blur": blur}
            with contextlib.redirect_stdout(io.StringIO()):
                product_lock.layout(self.ns(packshot=None, box=None, plan=self.plan(bg="#2040C0", shapes=[], products=[item])))
            sk = np.asarray(Image.open(os.path.join(self.dir.name, "out.png")).convert("RGB")).astype(int)
            rows[blur] = sk[300, :, 0] - sk[300, :, 2]   # red over the backdrop's own red-blue
        bg = rows[20][5]
        self.assertLess(np.abs(np.diff(rows[20])).max(), 25, "the blurred edge has no hard step")
        sharp, soft = np.nonzero(rows[0] - bg > 60)[0], np.nonzero(rows[20] - bg > 60)[0]
        self.assertAlmostEqual((sharp.min() + sharp.max()) / 2, (soft.min() + soft.max()) / 2, delta=1.5)  # the blur does not move it

    def test_reprint_restores_smeared_print_under_the_render_light(self):
        import cv2
        with contextlib.redirect_stdout(io.StringIO()):
            product_lock.layout(self.ns())
        sk = np.asarray(Image.open(os.path.join(self.dir.name, "out.png")).convert("RGB")).astype(np.float32)
        light = np.linspace(0.75, 1.0, sk.shape[1])[None, :, None]   # a window light across the picture
        ideal = sk * light
        render = ideal.copy()
        smear = cv2.GaussianBlur(render, (0, 0), 4)                  # the model smears the print; the carton edges stay
        for (y0, y1, x0, x1) in ((230, 380, 85, 140), (320, 385, 190, 380)):
            render[y0:y1, x0:x1] = smear[y0:y1, x0:x1]
        rpath = self.save("render.png", render.clip(0, 255))
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            product_lock.reprint(self.rp(rpath))
        self.assertIn("real print on 2 of 2 products", out.getvalue())
        got = np.asarray(Image.open(os.path.join(self.dir.name, "rp.png")).convert("RGB")).astype(np.float32)
        for (y0, y1, x0, x1) in ((230, 380, 85, 140), (320, 385, 190, 380)):
            before = np.abs(render[y0:y1, x0:x1] - ideal[y0:y1, x0:x1]).mean()
            after = np.abs(got[y0:y1, x0:x1] - ideal[y0:y1, x0:x1]).mean()
            self.assertLess(after, before * 0.5, f"print in {(y0, y1, x0, x1)} is not restored: {before:.1f} -> {after:.1f}")
        np.testing.assert_allclose(got[10:60, 10:390], render[10:60, 10:390], atol=2)  # away from the products nothing changes

    def test_reprint_keeps_a_coloured_pack_its_own_colour(self):
        # A kraft-brown pouch under neutral light: the render's colour holds the pack's own brown, so it must not tint the print twice.
        a = np.asarray(Image.open(self.pack).convert("RGB")).copy()
        a[20:240, 30:130][np.all(a[20:240, 30:130] == 232, axis=2)] = (182, 124, 68)
        a[100:140, 60:100][np.all(a[100:140, 60:100] == (182, 124, 68), axis=2)] = 250   # a white badge on the kraft face
        self.pack = self.save("kraft.png", a)
        with contextlib.redirect_stdout(io.StringIO()):
            product_lock.layout(self.ns())
        sk = np.asarray(Image.open(os.path.join(self.dir.name, "out.png")).convert("RGB")).astype(np.float32)
        ideal = sk * 0.85
        rpath = self.save("render.png", ideal.clip(0, 255))
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            product_lock.reprint(self.rp(rpath))
        self.assertIn("real print on 2 of 2 products", out.getvalue())
        got = np.asarray(Image.open(os.path.join(self.dir.name, "rp.png")).convert("RGB")).astype(np.float32)
        y0, y1, x0, x1 = 300, 380, 70, 100                                      # plain kraft on the upright pouch
        ratio = got[y0:y1, x0:x1].mean(axis=(0, 1)) / ideal[y0:y1, x0:x1].mean(axis=(0, 1))
        self.assertLess(ratio.max() - ratio.min(), 0.06, f"the print took a colour cast: {ratio.round(3)}")
        badge = (ideal.min(axis=2) > 200) & (ideal.max(axis=2) - ideal.min(axis=2) < 4)   # the white badge, neutral in the render
        self.assertGreater(int(badge.sum()), 200, "the fixture shows the white badge")
        rgb = got[badge].mean(axis=0)
        self.assertLess(rgb.max() - rgb.min(), 6, f"the white badge turned yellow: {rgb.round(1)}")

    def test_layout_lets_a_product_bleed_off_the_edge(self):
        # A lying carton cut by the left and top frame edges (the playbook asks for a box end past the edge).
        plan = self.plan(products=[{"cx": 0.02, "base": 0.1, "height": 0.4, "side": "R"}])
        with contextlib.redirect_stdout(io.StringIO()):
            product_lock.layout(self.ns(plan=plan))
        sk = np.asarray(Image.open(os.path.join(self.dir.name, "out.png")).convert("L"))
        self.assertGreater(int(sk[20, 25]), 200, "the carton's pale face shows at the top-left corner")

    def test_reprint_leaves_a_product_that_does_not_fit(self):
        flat = self.save("flat.png", np.full((500, 400, 3), 128))
        self.assertIn("no product fitted", exit_message(product_lock.reprint, self.rp(flat)))

    def test_bad_inputs_are_refused(self):
        self.assertIn("--face", exit_message(product_lock.reprint, self.rp(self.pack, face="0,0,50,50")))
        self.assertIn("same shape", exit_message(product_lock.reprint, self.rp(self.save("wide.png", np.full((300, 600, 3), 128)))))
        self.assertIn("side must be one of", exit_message(product_lock.layout, self.ns(plan=self.plan(products=[{"cx": 0.5, "base": 0.9, "height": 0.4, "side": "flat"}]))))
        self.assertIn("height must be a number", exit_message(product_lock.layout, self.ns(plan=self.plan(products=[{"cx": 0.5, "base": 0.9, "height": "big"}]))))
        self.assertIn("non-empty \"products\"", exit_message(product_lock.layout, self.ns(plan=self.plan(products=[]))))
        self.assertIn("rect must be", exit_message(product_lock.layout, self.ns(plan=self.plan(shapes=[{"rect": [0.5, 0, 0.2, 1]}]))))
        self.assertIn("--min-score", exit_message(product_lock.reprint, self.rp(self.pack, min_score=1.5)))
        self.assertIn("--search-scale", exit_message(product_lock.reprint, self.rp(self.pack, search_scale=float("nan"))))
        self.assertIn("--search-scale", exit_message(product_lock.reprint, self.rp(self.pack, search_scale=1.2)))
        self.assertIn("--search-rot", exit_message(product_lock.reprint, self.rp(self.pack, search_rot=-1)))
        self.assertIn("--search-px", exit_message(product_lock.reprint, self.rp(self.pack, search_px=-5)))
        self.assertIn("--light-px", exit_message(product_lock.reprint, self.rp(self.pack, light_px=0)))


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

    def test_the_engine_3_lockup_checks_size_and_clear_space(self):
        # Owner, 18-11-2026: big stacked type, and clear air between the words and the food.
        words = ["--font", self.FONT, "--case", "upper", "--headline", "The only | pie chart | I like.", "--area", "0.07,0.05,0.93,0.45"]
        out, msg = self.run_(*words, "--min-head", "0.07", "--product-top", "0.6")
        self.assertIn("headline", msg)
        self.assertIn("under --min-head", exit_message(self.run_, *words, "--min-head", "0.3"))
        self.assertIn("above the product top", exit_message(self.run_, *words, "--product-top", "0.44"))  # text ends at 41.8%
        self.assertIn("--product-top more than 0", exit_message(self.run_, *words, "--product-top", "0"))
        # The check measures the drawn ink: a descender under the last baseline counts (review on #112).
        low = ["--font", self.FONT, "--case", "upper", "--headline", "Ça | quip", "--area", "0.07,0.05,0.93,0.45"]
        _, msg = self.run_(*low)
        bottom = float(re.search(r"bottom ([0-9.]+)%", msg).group(1)) / 100  # the last baseline
        self.assertIn("above the product top", exit_message(self.run_, *low, "--product-top", f"{bottom + 0.045:.3f}"))

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

    def test_capitals_forced_breaks_and_an_accent_word(self):
        out, msg = self.run_("--font", self.FONT, "--headline", "Wait, there’s | ten?", "--case", "upper", "--leading", "0.97", "--align", "center",
                             "--accent", "ten?", "--accent-color", "FA363A", "--area", "0.05,0.2,0.95,0.6")
        self.assertNotIn("in 1 line(s)", msg)  # the " | " forces a break
        a = np.asarray(Image.open(out).convert("RGB")).astype(int)
        red = (a[..., 0] > 180) & (a[..., 1] < 110) & (a[..., 2] < 110)
        self.assertTrue(red.any(), "the accent word was not set in the accent colour")
        ys, _ = np.where(red)
        dark = (a.sum(2) < 150)
        dys, _ = np.where(dark)
        self.assertGreater(ys.min(), dys.min(), "the accent word belongs on the second line")
        self.assertIn("text top 20.0%", msg)

    def test_a_stub_line_is_avoided_when_a_smaller_size_fixes_it(self):
        self.assertTrue(headline.stub(["10 FLAVOURS", "FOR", "S$58.90."]))
        self.assertFalse(headline.stub(["CHOOSING", "IS THE", "HARD PART."]))
        self.assertFalse(headline.stub(["HI"]))
        out, msg = self.run_("--font", self.FONT, "--headline", "Ten flavours | for S$58.90.", "--case", "upper", "--area", "0.5,0.2,0.95,0.6")
        self.assertIn("in 2 line(s)", msg)

    def test_an_accent_needs_a_colour_and_a_word_of_the_headline(self):
        self.assertIn("--accent needs --accent-color", exit_message(self.run_, "--font", self.FONT, "--headline", "Hi there", "--area", "0,0,1,1", "--accent", "hi"))
        self.assertIn("not in the headline", exit_message(self.run_, "--font", self.FONT, "--headline", "Hi there", "--area", "0,0,1,1", "--accent", "bye", "--accent-color", "FF0000"))

    def test_a_bad_accent_colour_is_refused(self):
        self.assertIn("--accent-color must be a hex colour", exit_message(self.run_, "--font", self.FONT, "--headline", "Hi there", "--area", "0,0,1,1", "--accent", "hi", "--accent-color", "FF00000"))

    def test_an_accented_capital_stays_inside_the_area(self):
        out, msg = self.run_("--font", self.FONT, "--headline", "Élan", "--case", "upper", "--area", "0.1,0.3,0.9,0.5")
        a = np.asarray(Image.open(out).convert("L"))
        ys, _ = np.where(a < 100)
        self.assertGreaterEqual(ys.min(), 0.3 * 500 - 2)

    def test_the_logo_preview_is_drawn_at_the_top_centre(self):
        logo = os.path.join(self.dir.name, "logo.png")
        Image.new("RGBA", (100, 40), (0, 0, 0, 255)).save(logo)
        out, msg = self.run_("--font", self.FONT, "--headline", "Hi", "--area", "0.1,0.3,0.9,0.5", "--logo", logo)
        a = np.asarray(Image.open(out).convert("L"))
        self.assertLess(int(a[int(500 * 0.045) + 5, 200]), 60)  # the logo's middle
        self.assertGreater(int(a[int(500 * 0.045) + 5, 20]), 180)  # the backdrop beside it
        self.assertNotIn("WARNING", msg)

    def test_a_small_trade_mark_does_not_pull_the_centred_logo_left(self):
        # A wordmark with a small TM at its right top (the IRVINS logo): the wordmark, not the whole file, is centred.
        logo = os.path.join(self.dir.name, "logo.png")
        mark = Image.new("RGBA", (220, 60), (0, 0, 0, 0))
        mark.paste((0, 0, 0, 255), (0, 0, 200, 60))   # the wordmark
        mark.paste((0, 0, 0, 255), (208, 0, 220, 10))  # the TM: small, short, set apart
        mark.save(logo)
        out, _ = self.run_("--font", self.FONT, "--headline", "Hi", "--area", "0.1,0.3,0.9,0.5", "--logo", logo, "--logo-width", "0.55")
        a = np.asarray(Image.open(out).convert("L"))
        cols = np.where(a[int(500 * 0.045) + 12] < 60)[0]                # a row through the wordmark only, under the TM
        self.assertLess(abs((cols.min() + cols.max()) / 2 - 200), 2, "the wordmark is centred")
        # A trailing full stop sits low: it is part of the wordmark, so the whole file is centred.
        mark = Image.new("RGBA", (220, 60), (0, 0, 0, 0))
        mark.paste((0, 0, 0, 255), (0, 0, 200, 60))
        mark.paste((0, 0, 0, 255), (208, 50, 220, 60))
        mark.save(logo)
        out, _ = self.run_("--font", self.FONT, "--headline", "Hi", "--area", "0.1,0.3,0.9,0.5", "--logo", logo, "--logo-width", "0.55")
        a = np.asarray(Image.open(out).convert("L"))
        cols = np.where(a[int(500 * 0.045) + 55] < 60)[0]                # a row through the wordmark and the full stop
        self.assertLess(abs((cols.min() + cols.max()) / 2 - 200), 2, "the logo with its full stop is centred")

    def test_the_logo_can_head_a_text_column(self):
        logo = os.path.join(self.dir.name, "logo.png")
        Image.new("RGBA", (100, 40), (0, 0, 0, 255)).save(logo)
        out, msg = self.run_("--font", self.FONT, "--headline", "Hi", "--area", "0.5,0.3,0.9,0.5", "--logo", logo, "--logo-x", "0.5", "--logo-width", "0.3")
        a = np.asarray(Image.open(out).convert("L"))
        y = int(500 * 0.045) + 5
        self.assertLess(int(a[y, int(400 * 0.55)]), 60)  # inside the logo, right of the centre
        self.assertGreater(int(a[y, int(400 * 0.45)]), 200)  # left of it stays clear
        self.assertIn("--logo-x must", exit_message(self.run_, "--font", self.FONT, "--headline", "Hi", "--area", "0.5,0.3,0.9,0.5", "--logo", logo, "--logo-x", "0.9"))

    def test_a_logo_that_reaches_the_text_is_refused_before_drawing(self):
        logo = os.path.join(self.dir.name, "logo.png")
        Image.new("RGBA", (100, 100), (0, 0, 0, 255)).save(logo)
        msg = exit_message(self.run_, "--font", self.FONT, "--headline", "Hi", "--area", "0.1,0.1,0.9,0.5", "--logo", logo, "--logo-width", "0.5")
        self.assertIn("the logo bottom", msg)

    def test_a_leading_out_of_range_is_refused(self):
        self.assertIn("--leading must be", exit_message(self.run_, "--font", self.FONT, "--headline", "Hi", "--area", "0,0,1,1", "--leading", "0.3"))


class PhotoFinish(Tmp):
    def grey(self, v, size=(96, 128)):
        return Image.fromarray(np.full((size[1], size[0], 3), v, np.uint8))

    def test_strength_zero_changes_nothing(self):
        rng = np.random.default_rng(3)
        img = Image.fromarray(rng.integers(0, 256, (64, 48, 3), dtype=np.uint8))
        out = np.asarray(photo_finish.finish(img, strength=0, seed=1)).astype(int)
        self.assertLessEqual(int(np.abs(out - np.asarray(img).astype(int)).max()), 1)

    def test_the_same_seed_gives_the_same_grain(self):
        img = self.grey(128)
        a = np.asarray(photo_finish.finish(img, seed=7))
        b = np.asarray(photo_finish.finish(img, seed=7))
        c = np.asarray(photo_finish.finish(img, seed=8))
        self.assertTrue((a == b).all())
        self.assertFalse((a == c).all())

    def test_grain_is_stronger_in_the_midtones_than_in_deep_shadow(self):
        only_grain = ("tone", "soften", "halation", "lens")
        mid = np.asarray(photo_finish.finish(self.grey(128), skip=only_grain, seed=1).convert("L")).astype(float)
        dark = np.asarray(photo_finish.finish(self.grey(8), skip=only_grain, seed=1).convert("L")).astype(float)
        self.assertGreater(mid.std(), 0.5)
        self.assertGreater(mid.std(), dark.std() * 1.8)

    def test_tone_keeps_white_below_clipping_and_lifts_black(self):
        tone_only = ("soften", "halation", "lens", "grain")
        white = np.asarray(photo_finish.finish(self.grey(255), skip=tone_only))
        black = np.asarray(photo_finish.finish(self.grey(0), skip=tone_only))
        self.assertLess(int(white.max()), 252)
        self.assertGreater(int(black.min()), 1)
        grey = np.asarray(photo_finish.finish(self.grey(100), skip=tone_only)).astype(int)
        self.assertLessEqual(int(np.ptp(grey, axis=2).max()), 1)  # a grey stays grey

    def test_vignette_darkens_the_corners_not_the_centre(self):
        out = np.asarray(photo_finish.finish(self.grey(180, (200, 250)), skip=("tone", "soften", "halation", "grain")).convert("L")).astype(int)
        self.assertLess(out[2, 2], out[125, 100] - 5)
        self.assertGreaterEqual(out[125, 100], 179)

    def test_a_sharp_box_is_not_softened(self):
        a = np.full((128, 96, 3), 230, np.uint8)
        a[:, 47:49] = 20  # a thin dark line top to bottom
        img = Image.fromarray(a)
        steps = ("tone", "halation", "lens", "grain")
        big = {"soften_px": 24, "soften_mix": 1}  # sizes scale with the width: make the blur visible on a 96 px picture
        soft = np.asarray(photo_finish.finish(img, skip=steps, params=big).convert("L")).astype(int)
        kept = np.asarray(photo_finish.finish(img, skip=steps, sharp_boxes=[(0.3, 0.3, 0.7, 0.7)], params=big).convert("L")).astype(int)
        self.assertGreater(soft[64, 48], kept[64, 48] + 10)  # the line got lighter (softer) without the box
        self.assertLessEqual(abs(kept[64, 48] - 20), 2)

    def test_the_command_writes_a_jpeg_of_the_same_size(self):
        src = self.save("in.png", np.full((80, 64, 3), 150))
        out = os.path.join(self.dir.name, "out.jpg")
        with contextlib.redirect_stdout(io.StringIO()) as buf:
            photo_finish.main(["--in", src, "--out", out, "--seed", "1", "--sharp", "0.3,0.0,0.7,0.2"])
        with Image.open(out) as written:
            self.assertEqual(written.format, "JPEG")
            self.assertEqual(written.size, (64, 80))
        self.assertIn("sharp 1", buf.getvalue())

    def test_bad_input_stops_with_a_clear_message(self):
        out = os.path.join(self.dir.name, "o.jpg")
        self.assertIn("no picture at", exit_message(photo_finish.main, ["--in", "/no/such.jpg", "--out", out]))
        src = self.save("in.png", np.full((8, 8, 3), 150))
        self.assertIn("--sharp needs", exit_message(photo_finish.main, ["--in", src, "--out", out, "--sharp", "0.5,0.5,0.2,0.9"]))
        self.assertIn("--strength must be", exit_message(photo_finish.main, ["--in", src, "--out", out, "--strength", "3"]))
        self.assertIn("--grain-amp must be", exit_message(photo_finish.main, ["--in", src, "--out", out, "--grain-amp", "nan"]))
        self.assertIn("--soften-px must be", exit_message(photo_finish.main, ["--in", src, "--out", out, "--soften-px", "-1"]))
        self.assertIn("black < shoulder < white", exit_message(photo_finish.main, ["--in", src, "--out", out, "--shoulder", "0.99"]))
        self.assertIn("--halation-thr must be", exit_message(photo_finish.main, ["--in", src, "--out", out, "--halation-thr", "1"]))

    def test_chroma_grain_keeps_luma(self):
        img = self.grey(128, (64, 64))
        skip = ("tone", "soften", "halation", "lens")
        mono = photo_finish.finish(img, skip=skip, seed=3, params={"grain_amp": 0.05, "grain_chroma": 0})
        colour = photo_finish.finish(img, skip=skip, seed=3, params={"grain_amp": 0.05, "grain_chroma": 1})
        m, c = (np.asarray(x, np.float32) / 255 for x in (mono, colour))
        self.assertGreater(float(np.abs(c - m).max()), 5 / 255)  # the colour grain is there
        self.assertLess(float(np.abs(photo_finish.luma(c) - photo_finish.luma(m)).max()), 1.5 / 255)  # and it keeps luma

    def test_keep_holds_the_brand_colour(self):
        # Owner, 18-11-2026: the tone step turned the brand yellow olive. --keep holds it exact in tone and halation.
        yellow = Image.fromarray(np.full((64, 64, 3), (255, 210, 0), np.uint8))
        skip = ("soften", "lens", "grain")
        plain = np.asarray(photo_finish.finish(yellow, skip=skip)).astype(int)
        kept = np.asarray(photo_finish.finish(yellow, skip=skip, keep=[photo_finish.hex_rgb("#FFD200")])).astype(int)
        self.assertGreater(int(np.abs(plain - (255, 210, 0)).max()), 15)  # the shift the owner saw
        self.assertLessEqual(int(np.abs(kept - (255, 210, 0)).max()), 1)
        grey = Image.fromarray(np.full((64, 64, 3), 250, np.uint8))  # far from the colour: the normal finish
        self.assertTrue(np.array_equal(np.asarray(photo_finish.finish(grey, skip=skip)),
                                       np.asarray(photo_finish.finish(grey, skip=skip, keep=[(1.0, 0.82, 0.0)]))))
        src = self.save("y.png", np.full((64, 64, 3), (255, 210, 0)))
        out = os.path.join(self.dir.name, "o.png")
        self.assertIn("--keep needs", exit_message(photo_finish.main, ["--in", src, "--out", out, "--keep", "yellow"]))
        with contextlib.redirect_stdout(io.StringIO()) as log:
            photo_finish.main(["--in", src, "--out", out, "--keep", "FFD200", "--no-grain"])
        self.assertIn("keep FFD200", log.getvalue())


class PackCheck(Tmp):
    """Owner, 19-11-2026: the pack must match the real pack in every dimension; the brand's packshot is the guide."""

    def stage(self, h, w, clip=True):
        img = np.zeros((400, 300, 3))
        img[:] = (255, 212, 25)  # the stage colour
        img[300:320, 40:280] = (200, 160, 18)  # its shadow: the same hue, darker
        y0 = 300 - h
        img[y0:300, 150 - w // 2:150 + w // 2] = (120, 80, 50)  # the pack
        img[y0 + 20:y0 + 30, 140:160] = (255, 212, 25)  # yellow print on the pack: a hole in the mask
        if clip:
            img[y0 - 25:y0, 145:155] = (20, 20, 20)  # a clip on the top
        return self.save("r.png", img)

    def packshot(self, h, w):
        a = np.zeros((300, 300))
        a[150 - h // 2:150 + h // 2, 150 - w // 2:150 + w // 2] = 255
        return self.save("p.png", a)

    def check(self, *args):
        with contextlib.redirect_stdout(io.StringIO()) as log:
            code = pack_check.main(list(args))
        return code, log.getvalue()

    def test_a_pack_of_the_true_shape_passes_with_a_clip_and_a_shadow(self):
        code, log = self.check("--render", self.stage(214, 200), "--at", "150,200", "--bg", "FFD419", "--packshot", self.packshot(214, 200))
        self.assertEqual(code, 0, log)
        self.assertIn("PASS", log)

    def test_a_short_wide_pack_fails(self):
        code, log = self.check("--render", self.stage(180, 210), "--at", "150,250", "--bg", "FFD419", "--packshot", self.packshot(214, 200))
        self.assertEqual(code, 1, log)
        self.assertIn("FAIL", log)

    def test_a_stage_coloured_band_across_the_pack_does_not_split_it(self):
        img = np.zeros((400, 300, 3))
        img[:] = (255, 212, 25)
        img[86:300, 50:250] = (120, 80, 50)  # the pack, 214 x 200
        img[180:186, 50:250] = (255, 212, 25)  # a yellow print band from edge to edge
        code, log = self.check("--render", self.save("band.png", img), "--at", "150,250", "--bg", "FFD419", "--packshot", self.packshot(214, 200))
        self.assertEqual(code, 0, log)

    def test_a_grey_stage_is_not_measured_as_the_pack(self):
        img = np.full((400, 300, 3), 200.0)
        img[300:320, 40:280] = 150  # its shadow
        img[86:300, 50:250] = (120, 80, 50)
        code, log = self.check("--render", self.save("grey.png", img), "--at", "150,250", "--bg", "C8C8C8", "--packshot", self.packshot(214, 200))
        self.assertEqual(code, 0, log)

    def test_a_near_neutral_stage_is_not_measured_as_the_pack(self):
        img = np.zeros((400, 300, 3))
        img[:] = (200, 175, 165)  # C8AFA5: saturation 0.175, under 0.2 but over 0.15
        img[86:300, 50:250] = (165, 200, 175)  # a muted green pack: the same saturation and brightness, another hue
        code, log = self.check("--render", self.save("warm.png", img), "--at", "150,250", "--bg", "C8AFA5", "--packshot", self.packshot(214, 200))
        self.assertEqual(code, 0, log)

    def test_a_dark_coloured_stage_is_not_measured_as_the_pack(self):
        img = np.zeros((400, 300, 3))
        img[:] = (64, 0, 0)  # a deep red stage, 400000
        img[300:320, 40:280] = (36, 0, 0)  # its shadow: the same hue, darker
        img[86:300, 50:250] = (230, 225, 210)  # a pale pack
        code, log = self.check("--render", self.save("dark.png", img), "--at", "150,250", "--bg", "400000", "--packshot", self.packshot(214, 200))
        self.assertEqual(code, 0, log)

    def test_a_deep_shadow_of_a_bright_stage_is_not_measured_as_the_pack(self):
        img = np.zeros((400, 300, 3))
        img[:] = (255, 212, 25)
        img[86:300, 50:250] = (120, 80, 50)
        img[300:320, 40:260] = (60, 49, 5)  # a deep shadow that touches the pack
        code, log = self.check("--render", self.save("deep.png", img), "--at", "150,250", "--bg", "FFD419", "--packshot", self.packshot(214, 200))
        self.assertEqual(code, 0, log)

    def test_a_pack_on_its_side_passes_with_sideways(self):
        img = np.zeros((400, 400, 3))
        img[:] = (255, 212, 25)
        img[150:250, 50:350] = (120, 80, 50)  # the pack on its side: 100 high, 300 wide
        args = ["--render", self.save("side.png", img), "--at", "200,200", "--bg", "FFD419", "--packshot", self.packshot(300, 100)]
        self.assertEqual(self.check(*args)[0], 1)
        code, log = self.check(*args, "--sideways")
        self.assertEqual(code, 0, log)

    def test_a_point_on_the_stage_and_a_packshot_without_a_cut_out_stop_with_a_clear_message(self):
        r = self.stage(214, 200)
        self.assertIn("not inside the pack", exit_message(pack_check.main, ["--render", r, "--at", "5,5", "--bg", "FFD419", "--packshot", self.packshot(214, 200)]))
        flat = self.save("flat.png", np.full((50, 50, 3), 200))
        self.assertIn("cut-out packshot", exit_message(pack_check.main, ["--render", r, "--at", "150,200", "--bg", "FFD419", "--packshot", flat]))
        self.assertIn("RRGGBB", exit_message(pack_check.main, ["--render", r, "--at", "150,200", "--bg", "yellow", "--packshot", flat]))


if __name__ == "__main__":
    sys.exit(unittest.main())
