"""Container-only HTTP endpoint; the Worker default/public entrypoint is shut.

No credentials, AI services, databases, image files or user-input paths.
Native deadlines are enforced in supervisor.py, not a detached executor.
"""

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from .image_input import validate_image
from .supervisor import SupervisedCore

MAX_REQUEST = 2_900_000
MAX_RESPONSE = 512 * 1024


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError()
        result[key] = value
    return result


def handler_for(core):
    # One bounded upload/decode/native request; overlapping requests fail fast.
    active = threading.Lock()

    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def setup(self):
            super().setup()
            self.connection.settimeout(5)

        def log_message(self, *_args):
            pass

        def _reply(self, status, data):
            body = json.dumps(data, ensure_ascii=False).encode("utf-8")
            if len(body) > MAX_RESPONSE:
                status, body = 503, b'{"code":500,"data":"OCR_UNAVAILABLE"}'
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Connection", "close")
            self.end_headers()
            self.close_connection = True
            self.wfile.write(body)

        def do_GET(self):
            if self.path == "/ready":
                self._reply(200, {"ready": True})
            else:
                self._reply(404, {"code": 404, "data": "NOT_FOUND"})

        def do_POST(self):
            if self.path != "/api/ocr":
                return self._reply(404, {"code": 404, "data": "NOT_FOUND"})
            if not active.acquire(blocking=False):
                return self._reply(503, {"code": 850, "data": "OCR_BUSY"})
            try:
                if self.headers.get("Transfer-Encoding") or self.headers.get("Content-Encoding"):
                    raise ValueError()
                lengths = self.headers.get_all("Content-Length") or []
                if len(lengths) != 1 or not lengths[0].isdigit():
                    raise ValueError()
                size = int(lengths[0])
                if not 0 < size <= MAX_REQUEST:
                    raise ValueError()
                if self.headers.get("Content-Type", "").split(";")[0] != "application/json":
                    raise ValueError()
                raw = self.rfile.read(size)
                if len(raw) != size:
                    raise ValueError()
                payload = json.loads(raw.decode("utf-8"), object_pairs_hook=_unique_object)
                if not isinstance(payload, dict) or set(payload) - {"base64", "options"}:
                    raise ValueError()
                validate_image(payload.get("base64"))
                result = core.recognize(payload)
                status = 200 if result.get("code") in (100, 101) else 503
                return self._reply(status, result)
            except (ValueError, UnicodeError, TimeoutError):
                return self._reply(400, {"code": 802, "data": "OCR_INPUT_INVALID"})
            except Exception:
                return self._reply(503, {"code": 500, "data": "OCR_UNAVAILABLE"})
            finally:
                active.release()

    return Handler


class BoundedServer(ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 4

    def handle_error(self, *_args):
        pass

    def __init__(self, *args, **kwargs):
        self._connections = threading.BoundedSemaphore(4)
        super().__init__(*args, **kwargs)

    def process_request(self, request, client_address):
        if not self._connections.acquire(blocking=False):
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except Exception:
            self._connections.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self._connections.release()


def main():
    # Paths are constants in our image, never derived from upload/environment.
    core = SupervisedCore("/opt/paddle/bin/PaddleOCR-json", "/opt/paddle/models")
    core.initialize()
    server = BoundedServer(("0.0.0.0", 8080), handler_for(core))
    try:
        server.serve_forever()
    finally:
        server.server_close()
        core.close()


if __name__ == "__main__":
    main()
