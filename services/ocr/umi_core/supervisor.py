"""Supervise the imported, blocking Umi native pipe in a killable subprocess.

The production Linux child starts a process group; timeout kills the group,
including the Paddle child (not only a wrapper thread). IPC uses bounded JSON,
not pickle. Source/text/provider exceptions are never logged or returned.
"""

import json
import multiprocessing
import os
import signal
import threading
import time

from .core import create_native_core

MAX_IPC = 512 * 1024


def _native_child(connection, executable, models):
    if os.name == "posix":
        os.setsid()
    try:
        core = create_native_core(executable, models)
        connection.send_bytes(b'{"ready":true}')
        while True:
            payload = json.loads(connection.recv_bytes(3 * 1024 * 1024))
            result = core.recognize(payload)
            connection.send_bytes(json.dumps(result, ensure_ascii=False).encode("utf-8"))
            del payload, result
    except Exception:
        # Never transmit details that may contain a contact, filename or path.
        pass
    finally:
        connection.close()


class SupervisedCore:
    def __init__(self, executable, models, *, startup_seconds=20, recognition_seconds=4,
                 child_target=_native_child):
        self.executable, self.models = str(executable), str(models)
        self.startup_seconds, self.recognition_seconds = startup_seconds, recognition_seconds
        self._child_target = child_target
        self._process = self._connection = None
        self._lock = threading.Lock()

    @staticmethod
    def _kill(process):
        if os.name == "posix" and process.pid:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        if process.is_alive():
            process.kill()

    def _stop(self):
        process, connection = self._process, self._connection
        self._process = self._connection = None
        if process is not None:
            if process.pid is not None:
                self._kill(process)
                process.join(timeout=1)
            if not process.is_alive():
                process.close()
        if connection is not None:
            connection.close()

    def _receive(self, deadline):
        remaining = deadline - time.monotonic()
        if remaining <= 0 or not self._connection.poll(remaining):
            raise TimeoutError()
        return json.loads(self._connection.recv_bytes(MAX_IPC))

    def _start(self, deadline):
        if self._process is not None and self._process.is_alive():
            return
        self._stop()
        context = multiprocessing.get_context("spawn")
        parent, child = context.Pipe(duplex=True)
        process = context.Process(target=self._child_target,
                                  args=(child, self.executable, self.models), daemon=True)
        self._connection, self._process = parent, process
        process.start()
        child.close()
        if self._receive(deadline) != {"ready": True}:
            raise ValueError()

    def initialize(self):
        # Production starts the listener only after this succeeds.
        with self._lock:
            try:
                self._start(time.monotonic() + self.startup_seconds)
            except Exception:
                self._stop()
                raise RuntimeError("OCR_ENGINE_UNAVAILABLE") from None

    def recognize(self, payload):
        if not self._lock.acquire(blocking=False):
            return {"code": 850, "data": "OCR_BUSY"}
        watchdog = None
        try:
            # Restart plus recognition share one deadline, not two budgets.
            deadline = time.monotonic() + self.recognition_seconds
            self._start(deadline)
            # poll() doesn't bound a blocked send_bytes() on a full pipe. Kill
            # the child at the same deadline so a stalled receiver can't hang
            # the caller before it reaches the timed result read.
            watchdog = threading.Timer(max(0, deadline - time.monotonic()), self._kill, (self._process,))
            watchdog.daemon = True
            watchdog.start()
            self._connection.send_bytes(json.dumps(payload, ensure_ascii=True).encode("utf-8"))
            result = self._receive(deadline)
            if not isinstance(result, dict) or result.get("code") not in (100, 101):
                raise ValueError()
            return result
        except Exception:
            if watchdog is not None:
                watchdog.cancel()
                watchdog.join()
            self._stop()
            return {"code": 500, "data": "OCR_UNAVAILABLE"}
        finally:
            if watchdog is not None:
                watchdog.cancel()
                watchdog.join()
            self._lock.release()

    def close(self):
        with self._lock:
            self._stop()
