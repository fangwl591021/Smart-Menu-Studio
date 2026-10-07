import hashlib
import io
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fetch_engine import extract_engine, fetch_asset


class BuildTests(unittest.TestCase):
    def test_download_checks_actual_size_and_hash_before_use(self):
        value = b"synthetic-build-asset"
        asset = {"url": "https://github.com/synthetic/asset", "bytes": len(value),
                 "sha256": hashlib.sha256(value).hexdigest()}
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary) / "asset"
            with patch("urllib.request.urlopen", return_value=io.BytesIO(value)):
                fetch_asset(asset, target)
            self.assertEqual(target.read_bytes(), value)
            for bad in [{**asset, "sha256": "0" * 64}, {**asset, "bytes": len(value) - 1},
                        {**asset, "sha256": None}]:
                with patch("urllib.request.urlopen", return_value=io.BytesIO(value)):
                    with self.assertRaisesRegex(ValueError, "OCR_ASSET_"):
                        fetch_asset(bad, target)

    def test_archive_layout_and_fixed_traditional_config_alias(self):
        with tempfile.TemporaryDirectory() as temporary:
            archive = Path(temporary) / "bundle.tar.xz"
            with tarfile.open(archive, "w:xz") as bundle:
                for name, data in [("engine/bin/PaddleOCR-json", b"synthetic"),
                                   ("engine/models/config_chinese_cht.txt", b"rec_img_h 32\n")]:
                    item = tarfile.TarInfo(name)
                    item.size = len(data)
                    bundle.addfile(item, io.BytesIO(data))
            engine = extract_engine(archive, Path(temporary) / "unpacked", "engine")
            self.assertEqual((engine / "models/config_chinese_cht(v2).txt").read_bytes(), b"rec_img_h 32\n")

    def test_archive_cannot_escape_build_root(self):
        with tempfile.TemporaryDirectory() as temporary:
            archive = Path(temporary) / "bundle.tar.xz"
            with tarfile.open(archive, "w:xz") as bundle:
                item = tarfile.TarInfo("../unexpected")
                bundle.addfile(item, io.BytesIO(b""))
            with self.assertRaisesRegex(ValueError, "OCR_ASSET_PATH_INVALID"):
                extract_engine(archive, Path(temporary) / "unpacked", "engine")
