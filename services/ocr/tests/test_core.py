import base64
import copy
import json
import math
import threading
import unittest
from pathlib import Path

from umi_core import UmiOcrCore, create_native_core
from umi_core.core import PROFILE


IMAGE = base64.b64encode(b"\x89PNG\r\n\x1a\nsynthetic-test-only").decode()


def block(text, x=0, y=0, score=0.99):
    return {"text": text, "score": score, "box": [[x,y],[x+80,y],[x+80,y+20],[x,y+20]]}


class FakeEngine:
    def __init__(self, data=None):
        self.data = {"code": 100, "data": [block("Synthetic Contact")]} if data is None else data
        self.calls = []

    def runBase64(self, image):
        self.calls.append(image)
        return self.data


class CoreTests(unittest.TestCase):
    def test_import_has_no_desktop_dependencies(self):
        import sys
        self.assertFalse(any(name.startswith(("PySide", "PyQt", "psutil")) for name in sys.modules))

    def test_existing_worker_payload_contract(self):
        engine = FakeEngine()
        result = UmiOcrCore(engine).recognize({"base64": IMAGE, "options": PROFILE})
        self.assertEqual(result["code"], 100)
        self.assertEqual(result["data"][0]["text"], "Synthetic Contact")
        self.assertEqual(result["data"][0]["end"], "\n")
        self.assertEqual(result["data"][0]["score"], 0.99)
        self.assertEqual(engine.calls, [IMAGE])

    def test_extracted_umi_parser_orders_multiple_columns(self):
        data = [block("Right bottom", 200, 60), block("Left top", 0, 0),
                block("Right top", 200, 0), block("Left bottom", 0, 60)]
        original = copy.deepcopy(data)
        result = UmiOcrCore(FakeEngine({"code": 100, "data": data})).recognize({"base64": IMAGE})
        self.assertEqual([b["text"] for b in result["data"]],
                         ["Left top", "Left bottom", "Right top", "Right bottom"])
        self.assertEqual(data, original)
        self.assertNotIn("normalized_bbox", json.dumps(result))

    def test_no_input_paths_commands_or_host_options(self):
        engine = FakeEngine()
        core = UmiOcrCore(engine)
        for value in [None, [], {"base64": IMAGE, "exePath": "private-path"},
                      {"base64": IMAGE, "options": {"ocr.language": "another-model"}},
                      {"base64": IMAGE, "options": {"cpu_threads": 1000}},
                      {"base64": IMAGE, "options": {"ocr.cls": 1}},
                      {"base64": IMAGE, "options": []}]:
            self.assertEqual(core.recognize(value), {"code": 802, "data": "OCR_INPUT_INVALID"})
        self.assertEqual(engine.calls, [])

    def test_invalid_or_oversized_upload_never_reaches_engine(self):
        engine = FakeEngine()
        for value in ["", "!bad!", "https://unapproved.invalid/image.png", "A" * 2800000,
                      base64.b64encode(b"not an image").decode()]:
            self.assertEqual(UmiOcrCore(engine).recognize({"base64": value})["code"], 802)
        self.assertEqual(engine.calls, [])

    def test_bad_blocks_and_provider_details_fail_safely(self):
        data = [[], [block("x" * 4001)], [block("\x01")], [block("Example", score=math.nan)],
                [{**block("Example"), "box": [[0,0]]}],
                [{**block("Example"), "box": [[0,0],[0,0],[0,0],[0,0]]}],
                [block("Example", score=True)], [block("Example")] * 1501,
                [block("x" * 4000)] * 7]
        for blocks in data:
            result = UmiOcrCore(FakeEngine({"code": 100, "data": blocks})).recognize({"base64": IMAGE})
            self.assertEqual(result, {"code": 500, "data": "OCR_UNAVAILABLE"})
        result = UmiOcrCore(FakeEngine({"code": 904, "data": "PRIVATE-CONTACT/PATH"})).recognize({"base64": IMAGE})
        self.assertNotIn("PRIVATE", json.dumps(result))

    def test_no_text_preserves_upstream_code_without_error_details(self):
        result = UmiOcrCore(FakeEngine({"code": 101, "data": "private"})).recognize({"base64": IMAGE})
        self.assertEqual(result, {"code": 101, "data": []})

    def test_low_confidence_is_preserved_for_worker_routing(self):
        result = UmiOcrCore(FakeEngine({"code": 100, "data": [block("Uncertain Contact", score=0.8)]})).recognize({"base64": IMAGE})
        self.assertEqual(result["data"][0]["score"], 0.8)

    def test_engine_exception_does_not_leak_and_releases_lock(self):
        class Broken(FakeEngine):
            def runBase64(self, image):
                raise RuntimeError("PRIVATE token/path/contact")
        core = UmiOcrCore(Broken())
        for _ in range(2):
            self.assertEqual(core.recognize({"base64": IMAGE}), {"code": 500, "data": "OCR_UNAVAILABLE"})

    def test_overlapping_requests_fail_fast_without_second_engine_call(self):
        entered, release = threading.Event(), threading.Event()
        class Slow(FakeEngine):
            def runBase64(self, image):
                self.calls.append(image)
                entered.set()
                if not release.wait(2):
                    raise RuntimeError("test timeout")
                return self.data
        engine = Slow()
        core = UmiOcrCore(engine)
        first = []
        thread = threading.Thread(target=lambda: first.append(core.recognize({"base64": IMAGE})))
        thread.start()
        try:
            self.assertTrue(entered.wait(1))
            self.assertEqual(core.recognize({"base64": IMAGE}), {"code": 850, "data": "OCR_BUSY"})
            self.assertEqual(len(engine.calls), 1)
        finally:
            release.set()
            thread.join(2)
        self.assertEqual(first[0]["code"], 100)

    def test_missing_native_engine_is_not_fake_success(self):
        with self.assertRaisesRegex(ValueError, "^OCR_ENGINE_NOT_CONFIGURED$"):
            create_native_core(Path("missing-engine"), Path("missing-models"))


if __name__ == "__main__":
    unittest.main()
