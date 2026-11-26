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
cap_check = load("cap_check")
sys.path.insert(0, HERE)  # label_transfer imports shape_fix from its own folder, as in the finish kit
shape_fix = load("shape_fix")
label_transfer = load("label_transfer")


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

    def test_layout_leaves_no_dark_ring_on_a_soft_edge(self):
        # The piece was pasted with its own alpha as the mask, so the alpha applied twice: a soft edge came out darker
        # than both the item and the backdrop (a white item on a white backdrop showed a grey ring, 255 down to 223).
        white = np.full((120, 100, 3), 255, np.uint8)
        mask = np.zeros((120, 100), np.uint8); mask[10:110, 10:90] = 255
        self.save("white.png", white); self.save("m_white.png", mask)
        for blur in (0, 6):
            item = {"cx": 0.5, "base": 0.8, "height": 0.4, "rot": 7, "photo": "white.png", "alpha": "m_white.png", "blur": blur}
            with contextlib.redirect_stdout(io.StringIO()):
                product_lock.layout(self.ns(packshot=None, box=None, plan=self.plan(bg="#FFFFFF", shapes=[], products=[item])))
            sk = np.asarray(Image.open(os.path.join(self.dir.name, "out.png")).convert("RGB"))
            self.assertGreaterEqual(int(sk.min()), 250, f"blur {blur}: a white item on a white backdrop stays white")

    def test_layout_lets_a_product_bleed_off_the_edge(self):
        # A lying carton cut by the left and top frame edges (the playbook asks for a box end past the edge).
        plan = self.plan(products=[{"cx": 0.02, "base": 0.1, "height": 0.4, "side": "R"}])
        with contextlib.redirect_stdout(io.StringIO()):
            product_lock.layout(self.ns(plan=plan))
        sk = np.asarray(Image.open(os.path.join(self.dir.name, "out.png")).convert("L"))
        self.assertGreater(int(sk[20, 25]), 200, "the carton's pale face shows at the top-left corner")

    def food(self, top=30):
        """A real food photo: an orange block on a white backdrop, from row top to row 110, and its mask from cutout."""
        a = np.full((120, 100, 3), 255, np.uint8); a[top:110, 10:90] = (210, 140, 60)
        self.save("cake.png", a); self.save("m_cake.png", np.where(a.min(axis=2) < 250, 255, 0))
        return {"cx": 0.5, "base": 0.8, "height": 0.4, "photo": "cake.png", "alpha": "m_cake.png"}

    def lock(self, item, **over):
        with contextlib.redirect_stdout(io.StringIO()):
            product_lock.layout(self.ns(packshot=None, box=None, plan=self.plan(bg="#2040C0", shapes=[], products=[item], **over)))
        return np.asarray(Image.open(os.path.join(self.dir.name, "out.png")).convert("RGB")).astype(int)

    def food_box(self, sk):
        ys, xs = np.nonzero(sk[..., 0] - sk[..., 2] > 100)
        return xs.min(), ys.min(), xs.max() + 1, ys.max() + 1

    def test_layout_hole_keeps_the_backdrop_and_the_real_food_round_it(self):
        # Engine 1, owner 25-11-2026: the lock leaves a hole where an extra must show (peek ears behind a cake).
        item = self.food()
        full = self.lock(item)
        x0, y0, x1, y1 = self.food_box(full)
        top = y0 + (y1 - y0) // 3
        hole = [x0 / 400, y0 / 500, x1 / 400, top / 500]   # the upper third of the piece
        sk = self.lock(item, holes=[hole])
        bg = np.array((0x20, 0x40, 0xC0))
        inside = sk[round(hole[1] * 500) + 2:round(hole[3] * 500) - 2, x0 + 2:x1 - 2]
        self.assertLess(np.abs(inside - bg).max(), 3, "the hole is the plan's backdrop, not food")
        below = sk[top + 4:y1 - 4, x0 + 4:x1 - 4]
        self.assertTrue((below == full[top + 4:y1 - 4, x0 + 4:x1 - 4]).all(), "the food outside the hole is the real photo, pixel for pixel")
        self.assertLess(np.abs(below - (210, 140, 60)).max(), 6, "the food outside the hole has the photo's colour")

    def test_layout_hole_mask_makes_a_peek_shape(self):
        # The Cat & the Fiddle peek: the food fills the lower 70% of its photo; a hole at the top centre of the piece lets ears through.
        item = self.food(top=36)
        x0, y0, x1, y1 = self.food_box(self.lock(item))
        m = np.zeros((500, 400), np.uint8)
        cx = (x0 + x1) // 2
        m[y0 - 40:y0 + 30, cx - 25:cx + 25] = 255   # the ears' place: above the cake and into its top edge
        self.save("hole.png", m)
        sk = self.lock(item, holeMask="hole.png")
        self.assertLess(np.abs(sk[y0:y0 + 28, cx - 23:cx + 23] - (0x20, 0x40, 0xC0)).max(), 3, "the hole in the cake is empty")
        self.assertLess(np.abs(sk[y0 + 36:y1 - 6, x0 + 6:x1 - 6] - (210, 140, 60)).max(), 6, "the cake below the hole is intact")
        self.assertLess(np.abs(sk[y0 + 6:y0 + 28, x0 + 6:cx - 30] - (210, 140, 60)).max(), 6, "the cake beside the hole is intact")

    def test_layout_refuses_a_bad_hole(self):
        item = self.food()
        msg = exit_message(product_lock.layout, self.ns(packshot=None, box=None, plan=self.plan(products=[item], holes=[[0, 0, 1, 1]])))
        self.assertIn("cover all of its pixels", msg)
        msg = exit_message(product_lock.layout, self.ns(packshot=None, box=None, plan=self.plan(products=[item], holes=[[0.2, 0.9, 0.5, 1.2]])))
        self.assertIn("inside the canvas", msg)
        msg = exit_message(product_lock.layout, self.ns(packshot=None, box=None, plan=self.plan(products=[item], holes=[[0, 0, 0.1, 0.1]])))
        self.assertIn("lies outside every product", msg)
        self.save("small.png", np.zeros((50, 40), np.uint8))
        msg = exit_message(product_lock.layout, self.ns(packshot=None, box=None, plan=self.plan(products=[item], holeMask="small.png")))
        self.assertIn("the canvas is 400x500", msg)

    def test_product_lock_has_no_command_that_invents_an_angle(self):
        # Owner, 25-11-2026: refuse an angle that no real photo shows; never 3D-guess a top, a back or a cut from a front packshot.
        import subprocess
        out = subprocess.run([sys.executable, os.path.join(HERE, "product_lock.py"), "--help"], capture_output=True, text=True, check=True).stdout
        cmds = set(re.search(r"\{([a-z0-9,-]+)\}", out).group(1).split(","))
        self.assertEqual(cmds, {"relight", "vary-food", "cutout", "pad45", "open-source", "layout", "reprint", "skeleton", "swap"})

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

    def test_breathing_space_margins_and_the_logo_gap(self):
        # Owner, 20-11-2026 (Allies engine 3 test): the logo size changed from ad to ad, and the words sat too close to
        # the logo and the product: "all the empty space needing breathing space".
        words = ["--font", self.FONT, "--headline", "Hi there", "--area"]
        self.assertIn("leaves less than 4% of the width", exit_message(self.run_, *words, "0.02,0.3,0.9,0.5"))
        self.assertIn("leaves less than 4% of the width", exit_message(self.run_, *words, "0.1,0.3,0.98,0.5"))
        self.assertIn("from the top, less than --min-margin", exit_message(self.run_, *words, "0.1,0.02,0.9,0.5"))
        self.assertIn("--min-clear under 0.03", exit_message(self.run_, *words, "0.1,0.1,0.9,0.4", "--product-top", "0.6", "--min-clear", "0.02"))
        logo = os.path.join(self.dir.name, "logo.png")
        Image.new("RGBA", (100, 40), (0, 0, 0, 255)).save(logo)  # 0.25 of 400 px wide: 40 px high, its bottom at 12.5% of 500
        self.assertIn("less than --min-margin", exit_message(self.run_, *words, "0.1,0.3,0.9,0.5", "--logo", logo, "--logo-top", "0.02"))
        self.assertIn("gap between the logo bottom", exit_message(self.run_, *words, "0.1,0.14,0.9,0.5", "--logo", logo))
        out, msg = self.run_(*words, "0.1,0.16,0.9,0.5", "--logo", logo)
        self.assertIn("text top 16.0%", msg)
        # Devin Review, PR 140: a logo 1% from the right edge, and words that run to the bottom edge, passed.
        self.assertIn("less than --min-margin", exit_message(self.run_, *words, "0.1,0.3,0.9,0.5", "--logo", logo, "--logo-x", "0.74"))
        self.assertIn("above the bottom edge", exit_message(self.run_, *words, "0.1,0.9,0.9,0.995"))
        self.assertIn("only Latin-script", exit_message(self.run_, *words, "0.1,0.3,0.9,0.5", "--footnote", "专家评分"))
        # --min-margin 0 turns the margin check off for a picture that needs words to the edge.
        out, _ = self.run_(*words, "0,0,1,1", "--min-margin", "0")
        self.assertTrue(os.path.isfile(out))

    def test_the_footnote_sits_on_plain_backdrop_only(self):
        def run(src, *extra):
            out = os.path.join(self.dir.name, "out.jpg")
            with contextlib.redirect_stdout(io.StringIO()):
                headline.main(["--in", src, "--out", out, "--font", self.FONT, "--headline", "Hi there", "--area", "0.1,0.1,0.9,0.4",
                               "--footnote", "Expert scored, 35 people.", "--color", "000000", *extra])
            return out
        plain = self.save("plain.png", np.full((1000, 800, 3), 220))
        a = np.asarray(Image.open(run(plain)).convert("L"))
        ys, xs = np.where(a[800:] < 150)
        self.assertTrue(len(xs) > 0, "no footnote was drawn")
        self.assertAlmostEqual((ys.min() + ys.max()) / 2 + 800, 945, delta=8)
        self.assertGreaterEqual(xs.min(), 0.1 * 800 - 3)
        # The real failure: the handle of a hand mirror crossed the top of the footnote (Allies, 20-11-2026).
        handle = np.full((1000, 800, 3), 220)
        handle[925:940, 60:380] = 120  # a bar across the left footnote place
        self.assertIn("would sit on an object", exit_message(run, self.save("handle.png", handle)))
        a = np.asarray(Image.open(run(self.save("handle2.png", handle), "--footnote-align", "right")).convert("L"))
        ys, xs = np.where(a[940:] < 150)
        self.assertLessEqual(xs.max(), 0.9 * 800 + 3)
        self.assertIn("raise --footnote-y", exit_message(run, plain, "--footnote-y", "0.975"))

    def test_the_words_sit_on_one_tone(self):
        # The real failure (Cat & the Fiddle, engine 3, 21-11-2026): a white and brand-yellow (#FFC805) split down the middle
        # of the backdrop cut "Chocolate" and "so". Grain as the photo finish adds it; the check must ignore that.
        rng = np.random.default_rng(7)
        grain = lambda: rng.integers(-10, 11, (1280, 1024, 1))
        split = np.full((1280, 1024, 3), 255)
        split[:, 512:] = (255, 200, 5)
        split = self.save("split.png", np.clip(split + grain(), 0, 255))
        words = ["--font", self.FONT, "--case", "upper", "--headline", "Chocolate | or fruit?", "--subline", "Why not both, so everyone wins."]

        def run(src, area, sub="Why not both, so everyone wins."):
            out = os.path.join(self.dir.name, "out.jpg")
            with contextlib.redirect_stdout(io.StringIO()):
                headline.main(["--in", src, "--out", out, *words[:-1], sub, "--area", area])
            return out

        msg = exit_message(run, split, "0.07,0.08,0.93,0.33")
        self.assertRegex(msg, r"edge runs down through the words at (49\.\d|50\.\d)%")
        self.assertTrue(os.path.isfile(run(split, "0.06,0.08,0.46,0.33")))  # every word on the white half
        self.assertTrue(os.path.isfile(run(split, "0.54,0.08,0.94,0.33")))  # every word on the yellow half
        # A horizontal split between the lines: the headline on white, the subline on yellow.
        band = np.full((1280, 1024, 3), 255)
        band[200:] = (255, 200, 5)
        self.assertIn("edge runs across the words", exit_message(run, self.save("band.png", band), "0.07,0.08,0.93,0.33"))
        # Devin Review, PR 145: a split just beside the words passes; a split that runs only under a short subline fails.
        ink = np.asarray(Image.open(run(self.save("white.png", np.full((1280, 1024, 3), 255)), "0.07,0.08,0.93,0.33")).convert("L")) < 128
        cols, rows = np.where(ink.any(0))[0], np.where(ink.any(1))[0]
        beside = np.full((1280, 1024, 3), 255)
        beside[:, cols.max() + 12:] = (255, 200, 5)  # 12 px right of the last ink, past the glyph box
        self.assertTrue(os.path.isfile(run(self.save("beside.png", beside), "0.07,0.08,0.93,0.33")))
        # A short subline under a wide headline: the edge spans the subline but under 60% of the whole block.
        ink = np.asarray(Image.open(run(self.save("white2.png", np.full((1280, 1024, 3), 255)), "0.07,0.08,0.93,0.33", "So.")).convert("L")) < 128
        rows = np.where(ink.any(1))[0]
        sub_top = rows[np.where(np.diff(rows) > 1)[0][-1] + 1]  # the first ink row of the last line: the subline
        sub_right = int(np.where(ink[sub_top:].any(0))[0].max())
        self.assertLess(sub_right + 40 - 72, 0.6 * (int(np.where(ink.any(0))[0].max()) - 72))  # the whole block check alone misses it
        short = np.full((1280, 1024, 3), 255)
        short[sub_top + 6:, : sub_right + 40] = (255, 200, 5)  # the block ends past the line
        self.assertIn("edge runs across the words", exit_message(run, self.save("short.png", short), "0.07,0.08,0.93,0.33", "So."))
        # Devin Review, PR 145: a band that starts 2 px under the subline's last ink is beside the words, not through them.
        under = np.full((1280, 1024, 3), 255)
        under[rows.max() + 3:, : sub_right + 40] = (255, 200, 5)
        self.assertTrue(os.path.isfile(run(self.save("under.png", under), "0.07,0.08,0.93,0.33", "So.")))
        # A smooth light fall-off of 70 levels across the picture is one tone, not an edge.
        ramp = np.repeat(np.linspace(200, 130, 1024)[None, :, None], 1280, 0).repeat(3, 2)
        self.assertTrue(os.path.isfile(run(self.save("ramp.png", np.clip(ramp + grain(), 0, 255)), "0.07,0.08,0.93,0.33")))

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


class LogoOnly(Tmp):
    # Engine 1 (house rules WI, owner 23-11-2026): the kit logo with no words. It needs no font.
    def run_(self, *extra, src=None):
        src = src or self.save("in.png", np.full((500, 400, 3), 220))
        out = os.path.join(self.dir.name, "out.png")  # lossless, so a pixel outside the logo box must not change
        with contextlib.redirect_stdout(io.StringIO()) as buf:
            headline.main(["--in", src, "--out", out, *extra])
        return out, buf.getvalue()

    def logo(self, w=100, h=40):
        path = os.path.join(self.dir.name, "logo.png")
        Image.new("RGBA", (w, h), (0, 0, 0, 255)).save(path)
        return path

    def test_the_logo_alone_changes_only_the_logo_box(self):
        arr = np.full((500, 400, 3), 220)
        arr[300:, :] = (250, 200, 10)  # a yellow floor, untouched
        src = self.save("in.png", arr)
        out, msg = self.run_("--logo", self.logo(), "--logo-width", "0.25", "--logo-top", "0.05", src=src)
        a = np.asarray(Image.open(out).convert("RGB")).astype(int)
        lw, lh, ly = 100, 40, 25  # 0.25 x 400 wide, 40 x 100/100 high, 0.05 x 500 from the top
        lx = 200 - lw // 2
        self.assertLess(int(a[ly + 20, 200].mean()), 60)  # the logo's middle
        outside = np.ones(a.shape[:2], bool)
        outside[ly - 2:ly + lh + 2, lx - 2:lx + lw + 2] = False
        self.assertEqual(int(np.abs(a - arr)[outside].max()), 0, "only the logo box changed")
        self.assertIn("logo only", msg)

    def test_no_words_and_no_logo_is_refused(self):
        self.assertIn("--logo alone", exit_message(self.run_))
        self.assertIn("needs a headline", exit_message(self.run_, "--logo", self.logo(), "--subline", "So good."))
        self.assertIn("needs a headline", exit_message(self.run_, "--logo", self.logo(), "--footnote", "Study, 2025."))

    def test_an_empty_headline_with_type_options_is_refused(self):
        # An engine 2 or 3 call that lost its headline must not pass as a logo-only picture.
        self.assertIn("drop them for the logo only", exit_message(self.run_, "--logo", self.logo(), "--area", "0.1,0.1,0.9,0.3"))
        self.assertIn("drop them for the logo only", exit_message(self.run_, "--logo", self.logo(), "--family", "Inter"))

    def test_a_logo_too_near_the_edge_is_refused(self):
        self.assertIn("--min-margin", exit_message(self.run_, "--logo", self.logo(), "--logo-top", "0.01"))
        self.assertIn("--min-margin", exit_message(self.run_, "--logo", self.logo(), "--logo-width", "0.95"))
        self.assertIn("--min-margin", exit_message(self.run_, "--logo", self.logo(10, 100), "--logo-width", "0.1", "--logo-top", "0.9"))


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



class CapCheck(Tmp):
    """Owner, 20-11-2026 (Allies): the high-quality final put the cap 5.5 px right of the body centre (body 234 px,
    cap 183 px, at 1536 px wide); the draft had it centred."""

    STAGE = (160, 175, 244)  # a periwinkle stage, lighter than the bottle

    def bottle(self, shift):
        img = np.full((700, 400, 3), self.STAGE, dtype=float)
        img[100:330, 108 + shift:292 + shift] = (20, 30, 120)  # the cap, 184 px wide
        img[330:650, 83:317] = (25, 35, 130)  # the body, 234 px wide
        img[380:640, 100:118] = (120, 140, 230)  # a soft highlight inside the left edge
        img[400:560, 110:300:12] = 250  # white print: thin lines that reach near both edges
        return self.save("b.png", img)

    def check(self, *args):
        with contextlib.redirect_stdout(io.StringIO()) as log:
            code = cap_check.main(list(args))
        return code, log.getvalue()

    def test_a_centred_cap_passes_with_print_and_highlights_inside(self):
        code, log = self.check("--render", self.bottle(0), "--box", "40,60,360,650", "--split", "330")
        self.assertEqual(code, 0, log)
        self.assertIn("0.0 px", log)

    def test_the_allies_offset_fails(self):
        code, log = self.check("--render", self.bottle(6), "--box", "40,60,360,650", "--split", "330")
        self.assertEqual(code, 1, log)
        self.assertIn("right of the body centre", log)

    def test_a_centred_neck_does_not_hide_a_shifted_cap(self):
        # Devin Review, PR 141: a long centred neck and a short shifted cap of the same width gave one median.
        img = np.full((700, 400, 3), self.STAGE, dtype=float)
        img[100:120, 136:276] = (20, 30, 120)  # the cap, 140 px, 6 px right of the body centre
        img[120:160, 130:270] = (20, 30, 120)  # the neck, 140 px, centred
        img[160:650, 100:300] = (25, 35, 130)  # the body, 200 px
        code, log = self.check("--render", self.save("n.png", img), "--box", "40,60,360,650", "--split", "160")
        self.assertEqual(code, 1, log)
        self.assertIn("6.0 px right", log)

    def test_a_small_width_step_still_parts_the_cap_from_the_neck(self):
        # Devin Review, PR 141: a 4 px step from a 130 px cap to a centred neck must still cut the two apart.
        img = np.full((460, 400, 3), self.STAGE, dtype=float)
        img[20:40, 137:267] = (20, 30, 120)  # the cap, 130 px, 2 px right of the body centre
        img[40:120, 137:263] = (20, 30, 120)  # the neck, 126 px, centred
        img[120:420, 110:290] = (25, 35, 130)  # the body, 180 px
        code, log = self.check("--render", self.save("ws.png", img), "--box", "40,0,360,420", "--split", "120")
        self.assertEqual(code, 1, log)
        self.assertIn("2.0 px right", log)

    def test_the_body_is_below_split_whatever_its_shape(self):
        # Devin Review, PR 141: guessed bodies failed on a tapered body, a tall cap, a tall cap with a collar, a
        # smooth shoulder, a short taper and a short cap over a long shoulder. The body is now the rows below --split,
        # so each shape is measured.
        def taper(img, y0, y1, w0, w1, c=200):
            for i, y in enumerate(range(y0, y1)):
                w = w0 + 2 * round((w1 - w0) / 2 * i / (y1 - y0 - 1))
                img[y, c - w // 2:c + w // 2] = (25, 35, 130)

        def tall_cap(img, s):
            img[20:60, 135 + s:265 + s] = (20, 30, 120)  # a collar, 130 px
            img[60:310, 120 + s:280 + s] = (20, 30, 120)  # the cap, 250 rows, 160 px
            img[310:340, 150 + s:250 + s] = (20, 30, 120)  # the neck, 100 px
            img[340:520, 100:300] = (25, 35, 130)  # the body, 180 rows, 200 px
            return 340, 520

        def tapered_body(img, s):
            img[20:120, 130 + s:270 + s] = (20, 30, 120)  # the cap, 140 px
            img[120:150, 150 + s:250 + s] = (20, 30, 120)  # the neck, 100 px
            taper(img, 150, 360, 180, 220)  # the body, from 180 px to 220 px
            return 150, 360

        def short_taper(img, s):
            img[20:40, 145 + s:255 + s] = (20, 30, 120)  # the cap, 110 px
            img[40:50, 155:245] = (20, 30, 120)  # the neck, 90 px
            taper(img, 50, 130, 100, 200)  # the body, 80 rows, from 100 px to 200 px
            return 50, 130

        def shoulder(img, s):
            img[20:80, 130 + s:270 + s] = (20, 30, 120)  # the top, 140 px
            for i, y in enumerate(range(80, 110)):  # the shoulder, 2 px wider each row, back to the body centre
                w, c = 142 + 2 * i, 200 + s * (29 - i) / 30
                img[y, round(c - w / 2):round(c - w / 2) + w] = (20, 30, 120)
            img[110:350, 100:300] = (25, 35, 130)  # the body, 200 px
            return 80, 350  # --split at the top of the shoulder: the shoulder belongs to the body

        def short_cap_long_shoulder(img, s):
            img[20:40, 130 + s:270 + s] = (20, 30, 120)  # the cap, 20 rows, 140 px
            for i, y in enumerate(range(40, 100)):  # the shoulder, 60 rows, from 141 px to 200 px, back to the centre
                w, c = 141 + i, 200 + s * (59 - i) / 60
                img[y, round(c - w / 2):round(c - w / 2) + w] = (25, 35, 130)
            img[100:400, 100:300] = (25, 35, 130)  # the body, 200 px
            return 40, 400

        for shape in (tall_cap, tapered_body, short_taper, shoulder, short_cap_long_shoulder):
            for s, want in ((0, 0), (6, 1)):
                img = np.full((560, 400, 3), self.STAGE, dtype=float)
                split, bottom = shape(img, s)
                path = self.save(f"{shape.__name__}{s}.png", img)
                code, log = self.check("--render", path, "--box", f"40,0,360,{bottom}", "--split", str(split))
                self.assertEqual(code, want, f"{shape.__name__} {s}: {log}")
                if s:
                    self.assertIn("6.0 px right", log, shape.__name__)

    def test_an_offset_of_exactly_1_percent_passes(self):
        # Devin Review, PR 141: a smoothed width count read a 200 px body as 198 px, so a 2 px offset failed.
        img = np.full((460, 400, 3), self.STAGE, dtype=float)
        img[40:80, 132:272] = (20, 30, 120)  # the cap, 140 px, 2 px right of the body centre
        img[80:380, 100:300] = (25, 35, 130)  # the body, 200 px
        code, log = self.check("--render", self.save("e.png", img), "--box", "40,20,360,380", "--split", "80")
        self.assertEqual(code, 0, log)
        self.assertIn("2.0 px right of the body centre (1.0% of the 200 px body", log)

    def test_a_box_without_a_cap_or_a_split_outside_it_is_refused(self):
        self.assertIn("no cap found", exit_message(
            self.check, "--render", self.bottle(0), "--box", "40,340,360,650", "--split", "345"))
        self.assertIn("not inside the box", exit_message(
            self.check, "--render", self.bottle(0), "--box", "40,60,360,650", "--split", "700"))


class HueSafeTone(unittest.TestCase):
    """Owner, 26-11-2026 (B/SKIN): the lit side of a yellow bottle turned green in the finish. The tone step keeps hue."""

    @staticmethod
    def hue(rgb):
        import colorsys
        return colorsys.rgb_to_hsv(*(c / 255 for c in rgb))[0] * 360

    def test_a_bright_yellow_keeps_its_hue(self):
        lit = (252, 221, 75)  # the bottle's lit side in the real final; the old step gave (231, 217, 83), a lime
        img = Image.fromarray(np.full((32, 32, 3), lit, np.uint8))
        out = np.asarray(photo_finish.finish(img, skip=("soften", "halation", "lens", "grain")))[16, 16].astype(int)
        self.assertLess(int(out[0]), 245)  # the shoulder still rolls the highlight off
        self.assertLess(abs(self.hue(out) - self.hue(lit)), 1.0)
        self.assertLess(out[1] / out[0], 221 / 252 + 0.02)  # green did not gain on red (the old step gave 0.94)

    def test_full_strength_keeps_the_channel_order(self):
        # Devin Review, PR 156: a mix past strength 1 turned down and made a warm highlight blue.
        for c in [(255, 235, 221), (250, 245, 200), (255, 255, 240)]:
            img = Image.fromarray(np.full((16, 16, 3), c, np.uint8))
            out = np.asarray(photo_finish.finish(img, strength=2, skip=("soften", "halation", "lens", "grain")))[8, 8].astype(int)
            self.assertEqual(list(np.argsort(out, kind="stable")), list(np.argsort(c, kind="stable")), (c, out))
            self.assertLess(abs(self.hue(out) - self.hue(c)), 3.0, (c, out))

    def test_each_saturated_colour_keeps_its_hue(self):
        for c in [(255, 200, 0), (250, 120, 40), (60, 200, 250), (240, 230, 120), (200, 40, 160)]:
            img = Image.fromarray(np.full((16, 16, 3), c, np.uint8))
            out = np.asarray(photo_finish.finish(img, skip=("soften", "halation", "lens", "grain")))[8, 8]
            self.assertLess(abs(self.hue(out) - self.hue(c)), 1.5, c)


def bottle(size, bw, bh, cx, bot, capw, caph, ink=None, light=False, bg=(150, 210, 190)):
    """A front-on bottle: a yellow body with optional dark print, a white cap on top, on a mint backdrop."""
    H, W = size
    img = np.zeros((H, W, 3), np.float32)
    img[:] = bg
    x0, y0 = cx - bw // 2, bot - bh
    body = np.zeros((bh, bw, 3), np.float32)
    body[:] = (241, 184, 7)
    if light:  # the scene light: brighter on the left
        body *= np.linspace(1.08, 0.82, bw)[None, :, None]
    img[y0:bot, x0:x0 + bw] = np.clip(body, 0, 255)
    img[y0 - caph:y0, cx - capw // 2:cx - capw // 2 + capw] = (245, 244, 238)
    for fx0, fy0, fx1, fy1 in ink or []:  # print boxes as fractions of the body
        img[y0 + int(fy0 * bh):y0 + int(fy1 * bh), x0 + int(fx0 * bw):x0 + int(fx1 * bw)] = (40, 38, 36)
    return img


PRINT = [(0.25, 0.30, 0.75, 0.36), (0.20, 0.50, 0.80, 0.54), (0.30, 0.58, 0.70, 0.61), (0.22, 0.76, 0.32, 0.83), (0.62, 0.78, 0.74, 0.82)]


class ShapeFix(Tmp):
    """Owner, 26-11-2026: each model pass made the body 1 to 5% too tall for its width and the cap too narrow."""

    def run_(self, render, *extra):
        pack = self.save("p.png", bottle((300, 300), 100, 116, 150, 260, 70, 44, PRINT))
        src = self.save("r.png", render)
        out = os.path.join(self.dir.name, "o.png")
        with contextlib.redirect_stdout(io.StringIO()) as log:
            try:
                shape_fix.main(["--in", src, "--out", out, "--body", "F1B807", "--at", "205,330", "--packshot", pack, "--pack-at", "110,240", *extra])
                code = 0
            except SystemExit as e:
                code = e.code
        return code, log.getvalue(), out

    def test_a_narrow_body_and_cap_are_widened_to_the_packshot(self):
        code, log, out = self.run_(bottle((420, 400), 190, 232, 200, 380, 126, 88, PRINT, light=True), "--cap-h", "0.44")
        self.assertEqual(code, 0, log)
        self.assertIn("body widened", log)
        fixed = np.asarray(Image.open(out).convert("RGB")).astype(np.float32)
        d = shape_fix.body_region(fixed, (241, 184, 7), (205, 330))
        self.assertLess(abs(d["hw"] / (116 / 100) - 1), 0.02)
        self.assertLess(abs(shape_fix.cap_width(fixed, d, 0.44) / d["w"] - 0.70), 0.02)

    def test_a_true_shape_is_left_alone(self):
        render = bottle((420, 400), 200, 232, 200, 380, 140, 88, PRINT)
        code, log, out = self.run_(render)
        self.assertEqual(code, 0, log)
        self.assertNotIn("widened", log)
        self.assertTrue(np.array_equal(np.asarray(Image.open(out).convert("RGB")), render.astype(np.uint8)))

    def test_a_render_far_off_is_refused(self):
        code, log, _ = self.run_(bottle((420, 400), 170, 232, 200, 380, 120, 88, PRINT))
        self.assertIn("make the render again", str(code))

    def test_bad_inputs_stop_with_a_clear_message(self):
        render = bottle((420, 400), 200, 232, 200, 380, 140, 88, PRINT)
        self.assertIn("not on the body colour", str(self.run_(render, "--at", "5,5")[0]))
        self.assertIn("a clear colour", str(self.run_(render, "--body", "808080")[0]))
        self.assertIn("--cap-h must be", str(self.run_(render, "--cap-h", "9")[0]))


class LabelTransfer(Tmp):
    """Owner, 26-11-2026: the model redrew the small print (uneven spacing, ghosting). Only the real print is kept."""

    def run_(self, render):
        pack = self.save("p.png", bottle((300, 300), 100, 116, 150, 260, 70, 44, PRINT))
        src = self.save("r.png", render)
        out = os.path.join(self.dir.name, "o.png")
        with contextlib.redirect_stdout(io.StringIO()) as log:
            try:
                label_transfer.main(["--in", src, "--out", out, "--body", "F1B807", "--at", "265,320", "--packshot", pack, "--pack-at", "110,240"])
                code = 0
            except SystemExit as e:
                code = e.code
        return code, log.getvalue(), out

    def test_the_real_print_replaces_a_smeared_one_in_the_render_light(self):
        import cv2
        # The render: 1.5 x the packshot, lit from the left, its print smeared and one wrong (ghost) line added.
        render = bottle((480, 400), 150, 174, 200, 440, 105, 66, light=True)
        printed = bottle((480, 400), 150, 174, 200, 440, 105, 66, PRINT + [(0.25, 0.42, 0.75, 0.45)], light=True)
        render = cv2.GaussianBlur(printed, (0, 0), 2.5) * 0.6 + render * 0.4
        code, log, out = self.run_(render)
        self.assertEqual(code, 0, log)
        o = np.asarray(Image.open(out).convert("RGB")).astype(int)
        x0, y0 = 200 - 75, 440 - 174
        at = lambda fx, fy: o[y0 + int(fy * 174), x0 + int(fx * 150)]
        self.assertLess(at(0.5, 0.52).sum(), 3 * 90)  # a real print line is dark and crisp
        self.assertGreater(at(0.5, 0.435).sum(), 3 * 120)  # the ghost line is gone
        self.assertGreater(at(0.15, 0.70)[0], at(0.85, 0.70)[0] + 20)  # the render's light is kept: left brighter

    def test_a_studio_highlight_on_the_packshot_stays_behind(self):
        # Devin Review, PR 156: a bright strip on the packshot's plain label is not print and must not come across.
        pack = bottle((300, 300), 100, 116, 150, 260, 70, 44, PRINT)
        xs = np.arange(300)  # a narrow, soft-edged highlight at 0.87 of the width (as a studio light makes it), no print there
        glow = np.exp(-((xs - 187) / 2.5) ** 2)[None, :, None]
        pack[156:244] = pack[156:244] + (np.array([255, 250, 200]) - pack[156:244]) * glow * (pack[156:244, :, :1] > 200)
        render = bottle((480, 400), 150, 174, 200, 440, 105, 66, PRINT, light=True)
        src, pk = self.save("r.png", render), self.save("p2.png", pack)
        out = os.path.join(self.dir.name, "o.png")
        with contextlib.redirect_stdout(io.StringIO()):
            label_transfer.main(["--in", src, "--out", out, "--body", "F1B807", "--at", "265,320", "--packshot", pk, "--pack-at", "110,240"])
        o = np.asarray(Image.open(out).convert("RGB")).astype(int)
        x, y = 125 + int(0.87 * 150), 266 + int(0.45 * 174)
        self.assertLess(int(np.abs(o[y, x] - render[y, x]).max()), 12)  # the render's own light, no strip

    def test_a_separate_light_print_line_comes_across(self):
        # Devin Review, PR 156: a white line away from the dark print is real print and must come back.
        pack = bottle((300, 300), 100, 116, 150, 260, 70, 44, PRINT)
        pack[144 + int(0.66 * 116):144 + int(0.70 * 116), 100 + 35:100 + 65] = (252, 250, 244)  # a white net-weight line
        render = bottle((480, 400), 150, 174, 200, 440, 105, 66, PRINT, light=True)
        src, pk = self.save("r.png", render), self.save("p3.png", pack)
        out = os.path.join(self.dir.name, "o.png")
        with contextlib.redirect_stdout(io.StringIO()):
            label_transfer.main(["--in", src, "--out", out, "--body", "F1B807", "--at", "265,320", "--packshot", pk, "--pack-at", "110,240"])
        o = np.asarray(Image.open(out).convert("RGB")).astype(int)
        x, y = 125 + int(0.5 * 150), 266 + int(0.68 * 174)
        self.assertGreater(int(o[y, x, 2]), 150)  # white, not the yellow body (blue channel near 6)

    def test_a_render_with_no_matching_print_is_refused(self):
        code, _, _ = self.run_(bottle((480, 400), 150, 174, 200, 440, 105, 66, [(0.1, 0.2, 0.2, 0.9)]))
        self.assertIn("does not match the packshot", str(code))


class WordContrast(Tmp):
    """Owner, 26-11-2026 (B/SKIN tof): dark words on a mid sage wall were "really difficult to read"."""

    def run_(self, colour, back):
        src = self.save("in.png", np.full((500, 400, 3), back))
        out = os.path.join(self.dir.name, "out.jpg")
        with contextlib.redirect_stdout(io.StringIO()):
            headline.main(["--in", src, "--out", out, "--font", FONT, "--headline", "Light enough", "--subline", "Absorbs fast.",
                           "--area", "0.1,0.2,0.9,0.5", "--color", colour])
        return out

    def test_dark_words_on_mid_sage_are_refused_and_light_words_pass(self):
        sage = (123, 142, 123)  # the wall under the words of the rejected draft
        msg = exit_message(self.run_, "3B3836", sage)
        self.assertIn("hard to read", msg)
        self.assertIn("White words would give", msg)
        self.assertTrue(os.path.isfile(self.run_("F6F2EA", sage)))
        self.assertTrue(os.path.isfile(self.run_("3B3836", (219, 210, 185))))  # the cream wall: dark words pass

    def test_an_accent_word_is_checked_in_its_own_colour(self):
        # Devin Review, PR 156: ivory words with a red accent on sage passed, though the red word cannot be read.
        src = self.save("in.png", np.full((500, 400, 3), (123, 142, 123)))
        out = os.path.join(self.dir.name, "out.jpg")
        args = ["--in", src, "--out", out, "--font", FONT, "--headline", "Light enough", "--area", "0.1,0.2,0.9,0.5", "--color", "F6F2EA"]
        msg = exit_message(headline.main, args + ["--accent", "enough", "--accent-color", "DD4430"])
        self.assertIn("DD4430", msg)
        with contextlib.redirect_stdout(io.StringIO()):
            headline.main(args + ["--accent", "enough", "--accent-color", "FFE9A8"])  # a light accent reads

    def test_a_line_with_no_accent_is_checked_as_one_run(self):
        # Devin Review, PR 156: an accent on one line must not change the check of another line.
        runs = []
        orig = headline.backdrop_colour
        headline.backdrop_colour = lambda im, box: (runs.append(box), orig(im, box))[1]
        try:
            src = self.save("in.png", np.full((500, 400, 3), 230))
            out = os.path.join(self.dir.name, "out.jpg")
            with contextlib.redirect_stdout(io.StringIO()):
                headline.main(["--in", src, "--out", out, "--font", FONT, "--headline", "Ten flavours | one cake", "--area", "0.1,0.2,0.9,0.5",
                               "--accent", "cake", "--accent-color", "DD4430"])
        finally:
            headline.backdrop_colour = orig
        self.assertEqual(len(runs), 1 + 2)  # line 1 as one run; line 2 word by word ("one", "cake")

    def test_apca_knows_light_words_from_dark_words(self):
        self.assertGreater(headline.apca_lc((0, 0, 0), (255, 255, 255)), 100)
        self.assertLess(headline.apca_lc((255, 255, 255), (0, 0, 0)), -100)
        self.assertEqual(headline.apca_lc((128, 128, 128), (130, 130, 130)), 0)


if __name__ == "__main__":
    sys.exit(unittest.main())
