import base64
import http.client
import io
import json
import os
import threading
import time
import unittest

from PIL import Image

from umi_core.image_input import validate_image
from umi_core.server import BoundedServer, handler_for
from umi_core.supervisor import SupervisedCore


def image_bytes(width=2, height=2, format="PNG"):
    buffer = io.BytesIO()
    Image.new("RGB", (width, height), "white").save(buffer, format=format)
    return buffer.getvalue()


def fake_child(connection, executable, _models):
    if os.name == "posix":
        os.setsid()
    if executable == "hang-startup":
        time.sleep(30)
        return
    connection.send_bytes(b'{"ready":true}')
    if executable == "hang-read":
        time.sleep(30)
        return
    while True:
        try:
            payload = json.loads(connection.recv_bytes(3 * 1024 * 1024))
            if payload.get("hang"):
                time.sleep(30)
            elif payload.get("error"):
                connection.send_bytes(b'{"code":500,"data":"PRIVATE CONTACT"}')
            else:
                connection.send_bytes(b'{"code":101,"data":[]}')
        except EOFError:
            return


class HostTests(unittest.TestCase):
    def test_real_decode_of_supported_formats(self):
        for format in ["PNG", "JPEG", "WEBP"]:
            value = base64.b64encode(image_bytes(format=format)).decode()
            self.assertEqual(validate_image(value), value)

    def test_signature_is_not_a_valid_image(self):
        for raw in [b"\x89PNG\r\n\x1a\nfake", image_bytes()[:30]]:
            with self.assertRaisesRegex(ValueError, "OCR_INPUT_INVALID"):
                validate_image(base64.b64encode(raw).decode())

    def test_side_limit(self):
        with self.assertRaisesRegex(ValueError, "OCR_INPUT_INVALID"):
            validate_image(base64.b64encode(image_bytes(10001, 1)).decode())

    def test_animation_rejected(self):
        buffer = io.BytesIO()
        Image.new("RGB", (2, 2), "white").save(buffer, format="PNG", save_all=True,
                                             append_images=[Image.new("RGB", (2, 2), "black")])
        with self.assertRaisesRegex(ValueError, "OCR_INPUT_INVALID"):
            validate_image(base64.b64encode(buffer.getvalue()).decode())

    def supervisor(self, executable="success", recognition_seconds=1):
        core = SupervisedCore(executable, "synthetic", startup_seconds=1, recognition_seconds=recognition_seconds,
                              child_target=fake_child)
        self.addCleanup(core.close)
        return core

    def test_child_warm_and_success(self):
        core = self.supervisor()
        core.initialize()
        self.assertEqual(core.recognize({}), {"code": 101, "data": []})
        pid = core._process.pid
        self.assertEqual(core.recognize({}), {"code": 101, "data": []})
        self.assertEqual(core._process.pid, pid)

    def test_startup_timeout_kills_child(self):
        core = self.supervisor("hang-startup")
        start = time.monotonic()
        with self.assertRaisesRegex(RuntimeError, "OCR_ENGINE_UNAVAILABLE"):
            core.initialize()
        self.assertLess(time.monotonic() - start, 3)
        self.assertIsNone(core._process)

    def test_recognition_timeout_kills_and_next_call_recovers(self):
        core = self.supervisor(recognition_seconds=0.25)
        core.initialize()
        start = time.monotonic()
        self.assertEqual(core.recognize({"hang": True}), {"code": 500, "data": "OCR_UNAVAILABLE"})
        self.assertLess(time.monotonic() - start, 2)
        self.assertIsNone(core._process)
        core.recognition_seconds = 2
        self.assertEqual(core.recognize({}), {"code": 101, "data": []})

    def test_stalled_ipc_write_has_same_deadline(self):
        core = self.supervisor("hang-read", recognition_seconds=0.25)
        core.initialize()
        start = time.monotonic()
        self.assertEqual(core.recognize({"base64": "A" * 2_000_000})["code"], 500)
        self.assertLess(time.monotonic() - start, 2)
        self.assertIsNone(core._process)

    def test_busy_and_errors_do_not_leak(self):
        core = self.supervisor()
        core.initialize()
        core._lock.acquire()
        self.assertEqual(core.recognize({})["code"], 850)
        core._lock.release()
        self.assertEqual(core.recognize({"error": True}), {"code": 500, "data": "OCR_UNAVAILABLE"})

    def test_http_private_contract_no_images_written(self):
        class FakeCore:
            calls = []
            def recognize(self, payload):
                self.calls.append(payload)
                return {"code": 101, "data": []}
        core = FakeCore()
        server = BoundedServer(("127.0.0.1", 0), handler_for(core))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        body = json.dumps({"base64": base64.b64encode(image_bytes()).decode()})
        for path, payload, expected in [("/api/ocr", body, 200), ("/api/ocr", "{broken", 400),
                                        ("/api/doc/upload", body, 404), ("/api/ocr?path=x", body, 404),
                                        ("/api/ocr", '{"base64":"a","base64":"b"}', 400),
                                        ("/api/ocr", json.dumps({"base64":"https://x.invalid/a"}), 400)]:
            conn = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=2)
            conn.request("POST", path, body=payload, headers={"Content-Type": "application/json"})
            response = conn.getresponse()
            self.assertEqual(response.status, expected)
            self.assertEqual(response.getheader("Cache-Control"), "no-store")
            response.read()
            conn.close()
        self.assertEqual(len(core.calls), 1)
