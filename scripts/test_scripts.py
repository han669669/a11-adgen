"""Input checks of the Python scripts, on synthetic pictures. Run: python3 -m unittest discover -s scripts -p "test_*.py"

Needs the packages in scripts/requirements.txt. No real photo, no network.
"""
import contextlib
import importlib.util
import io
import os
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
        self.assertGreater(np.abs(b[20:40, 5:35] - a[20:40, 5:35]).sum(), 0)  # the kernels moved toward the reference
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


if __name__ == "__main__":
    sys.exit(unittest.main())
