"""Explicit opt-in container smoke test using generated data, no customer file.

This exercises the real binary and model, not a fake OCR result. Run inside a
fully built image with network disabled. It is not an accuracy benchmark.
"""

import base64
import io
import json

from PIL import Image, ImageDraw

from umi_core.image_input import validate_image
from umi_core.supervisor import SupervisedCore


def main():
    image = Image.new("RGB", (500, 120), "white")
    ImageDraw.Draw(image).text((15, 25), "OCR test 123", fill="black", font_size=40)
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    value = validate_image(base64.b64encode(buffer.getvalue()).decode())
    core = SupervisedCore("/opt/paddle/bin/PaddleOCR-json", "/opt/paddle/models",
                          recognition_seconds=15)
    try:
        core.initialize()
        result = core.recognize({"base64": value})
        if result.get("code") != 100 or not any("123" in row.get("text", "") for row in result.get("data", [])):
            raise RuntimeError("OCR_NATIVE_SMOKE_FAILED")
        print(json.dumps({"nativeSmoke": "passed", "blocks": len(result["data"])}))
    finally:
        core.close()


if __name__ == "__main__":
    main()
