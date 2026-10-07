"""Decode uploaded images before passing them to the native engine.

No file paths/URLs, no animation, no persisted images, bounded pixel count.
"""

import base64
import io
import warnings

from PIL import Image

from .core import _image

MAX_PIXELS = 12_000_000
MAX_SIDE = 10000


def validate_image(value):
    _image(value)
    raw = base64.b64decode(value, validate=True)
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(raw)) as image:
                if image.format not in {"PNG", "JPEG", "WEBP"}:
                    raise ValueError()
                width, height = image.size
                if width < 1 or height < 1 or max(width, height) > MAX_SIDE or width * height > MAX_PIXELS:
                    raise ValueError()
                if getattr(image, "n_frames", 1) != 1:
                    raise ValueError()
                image.verify()
            # verify() alone doesn't always decode compressed pixel data.
            with Image.open(io.BytesIO(raw)) as image:
                image.load()
    except Exception:
        raise ValueError("OCR_INPUT_INVALID") from None
    return value
