"""No desktop UI, AI key, database, public listener, or automatic downloads.

This module requires a native backend, not the ordinary Workers isolate.
Production hosting must supervise native initialization/recognition deadlines.
The imported Umi pipe does blocking reads and is not itself a timeout supervisor.
"""

import base64
import binascii
import copy
import json
import math
import threading
from pathlib import Path
from typing import Protocol

from .vendor.tbpu.parser_multi_line import MultiLine

MAX_IMAGE_BYTES = 2 * 1024 * 1024
MAX_TEXT = 24000
PROFILE = {
    "ocr.language": "models/config_chinese_cht(v2).txt",
    "ocr.cls": True,
    "ocr.limit_side_len": 2880,
    "tbpu.parser": "multi_line",
    "data.format": "dict",
}


class NativeEngine(Protocol):
    def runBase64(self, image: str) -> dict: ...


def _image(value):
    if not isinstance(value, str) or not value or len(value) > ((MAX_IMAGE_BYTES + 2) // 3) * 4:
        raise ValueError("OCR_INPUT_INVALID")
    try:
        raw = base64.b64decode(value, validate=True)
    except (binascii.Error, ValueError):
        raise ValueError("OCR_INPUT_INVALID") from None
    supported = raw.startswith(b"\x89PNG\r\n\x1a\n") or raw.startswith(b"\xff\xd8\xff")
    supported = supported or (raw.startswith(b"RIFF") and raw[8:12] == b"WEBP")
    if not supported or len(raw) > MAX_IMAGE_BYTES:
        raise ValueError("OCR_INPUT_INVALID")
    return value


def _number(value):
    return type(value) in (int, float) and math.isfinite(value)


def _blocks(value):
    if not isinstance(value, list) or not value or len(value) > 1500:
        raise ValueError("OCR_RESULT_INVALID")
    result, total = [], 0
    for block in value:
        if not isinstance(block, dict):
            raise ValueError("OCR_RESULT_INVALID")
        text, score, box = block.get("text"), block.get("score"), block.get("box")
        if not isinstance(text, str) or not text.strip() or len(text) > 4000:
            raise ValueError("OCR_RESULT_INVALID")
        if not _number(score) or not 0 <= score <= 1:
            raise ValueError("OCR_RESULT_INVALID")
        if not isinstance(box, list) or len(box) != 4 or any(
            not isinstance(point, list) or len(point) != 2
            or any(not _number(n) or not 0 <= n <= 100000 for n in point)
            for point in box
        ):
            raise ValueError("OCR_RESULT_INVALID")
        if max(p[0] for p in box) <= min(p[0] for p in box) or max(p[1] for p in box) <= min(p[1] for p in box):
            raise ValueError("OCR_RESULT_INVALID")
        text = "".join(c for c in text if ord(c) >= 32 or c in "\n\t").replace("\x7f", "").strip()
        total += len(text)
        if not text or total > MAX_TEXT:
            raise ValueError("OCR_RESULT_INVALID")
        result.append({"text": text, "score": score, "box": copy.deepcopy(box)})
    return result


class UmiOcrCore:
    """Fixed Traditional-Chinese profile; each instance owns one native engine.

    Reentrant calls fail fast so they can fall back to the existing AI instead
    of building an unbounded queue. A hosting process supplies supervision.
    """

    def __init__(self, engine: NativeEngine):
        self._engine = engine
        self._lock = threading.Lock()

    def recognize(self, payload):
        # Never let upload data choose executables, model paths, flags or URLs.
        try:
            if not isinstance(payload, dict) or set(payload) - {"base64", "options"}:
                raise ValueError("OCR_INPUT_INVALID")
            options = payload.get("options", {})
            if not isinstance(options, dict) or any(
                key not in PROFILE or type(value) is not type(PROFILE[key]) or value != PROFILE[key]
                for key, value in options.items()
            ):
                raise ValueError("OCR_INPUT_INVALID")
            image = _image(payload.get("base64"))
        except ValueError:
            return {"code": 802, "data": "OCR_INPUT_INVALID"}
        if not self._lock.acquire(blocking=False):
            return {"code": 850, "data": "OCR_BUSY"}
        try:
            raw = self._engine.runBase64(image)
            if not isinstance(raw, dict):
                raise ValueError("OCR_RESULT_INVALID")
            if raw.get("code") == 101:
                return {"code": 101, "data": []}
            if raw.get("code") != 100:
                raise ValueError("OCR_RESULT_INVALID")
            # The original Umi parser sorts copied blocks and preserves scores.
            # A fresh parser avoids retaining another request's layout state.
            result = {"code": 100, "data": MultiLine().run(_blocks(raw.get("data")))}
            if len(json.dumps(result, ensure_ascii=False).encode("utf-8")) > 512 * 1024:
                raise ValueError("OCR_RESULT_INVALID")
            return result
        except Exception:
            # Native responses may contain paths and printed contact details.
            # Never return or log them on an error.
            return {"code": 500, "data": "OCR_UNAVAILABLE"}
        finally:
            self._lock.release()


def create_native_core(executable: Path, models: Path):
    """Explicit trusted-host setup only; no process starts during import.

    The caller must supervise startup/processing timeouts and resources before
    exposing this core through an authenticated service. No engine is bundled.
    """
    executable, models = Path(executable).resolve(), Path(models).resolve()
    language = models / "config_chinese_cht(v2).txt"
    if not executable.is_file() or not models.is_dir() or not language.is_file():
        raise ValueError("OCR_ENGINE_NOT_CONFIGURED")
    from .vendor.paddle.PPOCR_api import PPOCR_pipe

    try:
        engine = PPOCR_pipe(str(executable), str(models), argument={
            "config_path": str(language), "cls": True, "use_angle_cls": True,
            "limit_side_len": 2880, "cpu_threads": 2,
        })
    except Exception:
        raise ValueError("OCR_ENGINE_UNAVAILABLE") from None
    return UmiOcrCore(engine)
