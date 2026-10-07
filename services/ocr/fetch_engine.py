"""Build-time only: download a pinned official native engine and its models.

No downloads or self-updates happen in the running container. The SHA256 pins
are locally measured from the official GitHub release, not publisher signatures.
"""

import hashlib
import json
import shutil
import sys
import tarfile
import tempfile
import urllib.request
from pathlib import Path


def fetch_asset(asset, target):
    if not isinstance(asset.get("sha256"), str) or len(asset["sha256"]) != 64:
        raise ValueError("OCR_ASSET_NOT_PINNED")
    digest, size = hashlib.sha256(), 0
    request = urllib.request.Request(asset["url"], headers={"User-Agent": "Smart-Menu-OCR-build"})
    with urllib.request.urlopen(request, timeout=30) as response, open(target, "wb") as output:
        while chunk := response.read(1024 * 1024):
            size += len(chunk)
            if size > asset["bytes"]:
                raise ValueError("OCR_ASSET_SIZE_MISMATCH")
            digest.update(chunk)
            output.write(chunk)
    if size != asset["bytes"] or digest.hexdigest() != asset["sha256"]:
        raise ValueError("OCR_ASSET_HASH_MISMATCH")


def extract_engine(archive, destination, root):
    with tarfile.open(archive, "r:xz") as bundle:
        members = bundle.getmembers()
        if len(members) > 2000 or sum(max(0, item.size) for item in members) > 800 * 1024 * 1024:
            raise ValueError("OCR_ASSET_SIZE_MISMATCH")
        for item in members:
            if not (item.name == root or item.name.startswith(root + "/")):
                raise ValueError("OCR_ASSET_PATH_INVALID")
        bundle.extractall(destination, filter="data")
    engine = Path(destination) / root
    if not (engine / "bin/PaddleOCR-json").is_file() or not (engine / "models/config_chinese_cht.txt").is_file():
        raise ValueError("OCR_ASSET_LAYOUT_INVALID")
    # Our existing fixed Umi profile uses this alias. This is a byte-for-byte
    # copy, not a new language model or changed recognition configuration.
    shutil.copyfile(engine / "models/config_chinese_cht.txt", engine / "models/config_chinese_cht(v2).txt")
    return engine


def main():
    manifest = json.loads(Path(__file__).with_name("native-artifacts.json").read_text(encoding="utf-8"))
    target = Path(sys.argv[1])
    if target.exists():
        raise ValueError("OCR_BUILD_TARGET_EXISTS")
    with tempfile.TemporaryDirectory(prefix="smart-menu-ocr-build-") as temporary:
        root = Path(temporary)
        archive = root / "engine.tar.xz"
        fetch_asset(manifest["engine"], archive)
        engine = extract_engine(archive, root, manifest["engine"]["root"])
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(engine, target, symlinks=True)


if __name__ == "__main__":
    main()
