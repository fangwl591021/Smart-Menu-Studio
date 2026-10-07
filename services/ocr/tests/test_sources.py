import hashlib
import io
import os
import tempfile
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from unittest.mock import patch

from fetch_sources import (MAX_FILE_BYTES, MAX_TOTAL_BYTES, SourceRedirectHandler,
                           retain_sources, source_download_policy, validate_sources,
                           validate_target, validate_url, verify_sources)


def asset(name="source.tar.gz", value=b"synthetic source", **changes):
    return {"name": name, "url": "https://deb.debian.org/debian/pool/main/s/source/" + name,
            "bytes": len(value), "sha256": hashlib.sha256(value).hexdigest(), **changes}


class SourceRetentionTests(unittest.TestCase):
    def test_valid_multiple_archives_preserve_exact_bytes(self):
        values = [b"synthetic gzip archive", b"synthetic xz archive", b"synthetic dsc"]
        assets = [asset(name, value) for name, value in
                  zip(["eigen.tar.gz", "gcc.orig.tar.xz", "gcc+deb.dsc"], values)]
        assets[0]["url"] = "https://codeload.github.com/synthetic/eigen/tar.gz/pinned"
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary) / "ocr-sources"
            with patch("urllib.request.urlopen", side_effect=[io.BytesIO(value) for value in values]):
                self.assertEqual(retain_sources({"sourceArchives": assets}, target), 3)
            self.assertEqual(sorted(path.name for path in target.iterdir()), sorted(a["name"] for a in assets))
            for entry, value in zip(assets, values):
                self.assertEqual((target / entry["name"]).read_bytes(), value)
                if os.name == "posix":
                    self.assertEqual((target / entry["name"]).stat().st_mode & 0o777, 0o644)
            if os.name == "posix":
                self.assertEqual(target.stat().st_mode & 0o777, 0o755)

    def test_only_allowlisted_https_urls_without_credentials_or_query(self):
        valid = "https://deb.debian.org/debian/source.tar.xz"
        self.assertEqual(validate_url(valid), valid)
        for url in ["http://deb.debian.org/debian/source.tar.gz",
                    "https://example.com/source.tar.gz", "https://deb.debian.org.evil.test/a",
                    "https://user:password@deb.debian.org/a", "https://deb.debian.org:443/a",
                    "https://deb.debian.org/a#fragment", "https://deb.debian.org/a?secret=x",
                    "https://deb.debian.org/a#", "https://deb.debian.org/a?",
                    "https://deb.debian.org/../a", "https://deb.debian.org/%2e%2e/a",
                    "https://deb.debian.org/a\\b", "https://deb.debian.org/a%5cb",
                    "https://deb.debian.org/a\nb", None]:
            with self.subTest(url=url), self.assertRaisesRegex(ValueError, "OCR_SOURCE_URL_INVALID"):
                validate_url(url)

    def test_redirects_cannot_escape_https_host_allowlist(self):
        handler = SourceRedirectHandler()
        request = urllib.request.Request("https://deb.debian.org/first.tar.gz")
        for url in ["https://example.com/second.tar.gz", "http://deb.debian.org/second.tar.gz"]:
            with self.assertRaisesRegex(ValueError, "OCR_SOURCE_URL_INVALID"):
                handler.redirect_request(request, None, 302, "Found", {}, url)
        redirected = handler.redirect_request(request, None, 302, "Found", {},
                                              "https://codeload.github.com/synthetic/source/tar.gz/pin")
        self.assertEqual(redirected.host, "codeload.github.com")

    def test_unsafe_or_duplicate_filenames_rejected(self):
        for name in ["../source.tar.gz", "source/asset.tar.gz", "source\\asset.tar.gz",
                     ".source.tar.gz", "source..tar.gz", "source.zip", "source.py", "NUL.dsc",
                     "CON.tar.gz", "COM1.tar.xz", "a" * 170 + ".dsc"]:
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, "OCR_SOURCE_NAME_INVALID"):
                validate_sources({"sourceArchives": [asset(name)]})
        for duplicate in ["source.tar.gz", "SOURCE.tar.gz"]:
            with self.assertRaisesRegex(ValueError, "OCR_SOURCE_NAME_INVALID"):
                validate_sources({"sourceArchives": [asset(), asset(duplicate)]})

    def test_manifest_shape_count_hash_and_size_bounds(self):
        for manifest in [None, {}, {"sourceArchives": []}, {"sourceArchives": {}},
                         {"sourceArchives": [asset(str(number) + ".dsc") for number in range(11)]},
                         {"sourceArchives": [None]}, {"sourceArchives": [{**asset(), "extra": True}]}]:
            with self.assertRaisesRegex(ValueError, "OCR_SOURCE_MANIFEST_INVALID"):
                validate_sources(manifest)
        for digest in ["0" * 63, "A" * 64, "z" * 64, None]:
            with self.assertRaisesRegex(ValueError, "OCR_SOURCE_HASH_INVALID"):
                validate_sources({"sourceArchives": [asset(sha256=digest)]})
        for size in [0, -1, True, 1.0, MAX_FILE_BYTES + 1]:
            with self.assertRaisesRegex(ValueError, "OCR_SOURCE_SIZE_INVALID"):
                validate_sources({"sourceArchives": [asset(bytes=size)]})
        with self.assertRaisesRegex(ValueError, "OCR_SOURCE_SIZE_INVALID"):
            validate_sources({"sourceArchives": [asset("first.tar.gz", bytes=MAX_FILE_BYTES),
                                                 asset("second.tar.gz", bytes=MAX_TOTAL_BYTES - MAX_FILE_BYTES + 1)]})

    def test_existing_and_computed_targets_cannot_be_overwritten(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            target = root / "ocr-sources"
            target.mkdir()
            with self.assertRaisesRegex(ValueError, "OCR_SOURCE_TARGET_EXISTS"):
                validate_target(target)
            for value in [root, root / "different-name", root / "missing/ocr-sources",
                          root / "child/../ocr-sources", "ocr-sources", root.anchor]:
                with self.subTest(value=str(value)), self.assertRaisesRegex(ValueError, "OCR_SOURCE_TARGET_"):
                    validate_target(value)

    def test_parent_symlink_and_dangling_target_are_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            real = root / "real"
            real.mkdir()
            link = root / "link"
            try:
                link.symlink_to(real, target_is_directory=True)
            except OSError as error:
                self.skipTest(f"Symlink creation is unavailable: {error}")
            with self.assertRaisesRegex(ValueError, "OCR_SOURCE_TARGET_INVALID"):
                validate_target(link / "ocr-sources")
            target = real / "ocr-sources"
            target.symlink_to(real / "missing", target_is_directory=True)
            with self.assertRaisesRegex(ValueError, "OCR_SOURCE_TARGET_EXISTS"):
                validate_target(target)

    def test_failed_download_never_publishes_partial_sources(self):
        for failure in [ValueError("OCR_ASSET_HASH_MISMATCH"), urllib.error.URLError("synthetic failure")]:
            with tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                target = root / "ocr-sources"
                with patch("urllib.request.urlopen", side_effect=[io.BytesIO(b"synthetic source"), failure]):
                    with self.assertRaises((ValueError, urllib.error.URLError)):
                        retain_sources({"sourceArchives": [asset("first.dsc"), asset("second.dsc")]}, target)
                self.assertFalse(target.exists())
                self.assertEqual(list(root.iterdir()), [])

    def test_actual_hash_and_size_failure_cleans_staging(self):
        for change in [{"sha256": "0" * 64}, {"bytes": 2}, {"bytes": 100}]:
            with tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                with patch("urllib.request.urlopen", return_value=io.BytesIO(b"synthetic source")):
                    with self.assertRaisesRegex(ValueError, "OCR_ASSET_"):
                        retain_sources({"sourceArchives": [asset(**change)]}, root / "ocr-sources")
                self.assertEqual(list(root.iterdir()), [])

    def test_invalid_manifest_does_not_touch_target_or_download(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            with patch("urllib.request.urlopen") as download:
                with self.assertRaisesRegex(ValueError, "OCR_SOURCE_HASH_INVALID"):
                    retain_sources({"sourceArchives": [asset(sha256="invalid")]}, root / "ocr-sources")
            download.assert_not_called()
            self.assertEqual(list(root.iterdir()), [])

    def test_download_policy_restores_existing_opener_on_failure(self):
        previous = urllib.request._opener
        with self.assertRaisesRegex(RuntimeError, "synthetic"):
            with source_download_policy():
                self.assertIsNot(urllib.request._opener, previous)
                raise RuntimeError("synthetic")
        self.assertIs(urllib.request._opener, previous)

    def test_retained_source_set_must_match_exact_names_sizes_and_hashes(self):
        entry = asset("source.tar.gz")
        value = b"synthetic source"
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary) / "remote"
            target.mkdir()
            path = target / entry["name"]
            path.write_bytes(value)
            self.assertEqual(verify_sources([entry], target), 1)
            extra = target / "extra.txt"
            extra.write_bytes(b"untracked")
            with self.assertRaisesRegex(ValueError, "OCR_SOURCE_RETAINED_INVALID"):
                verify_sources([entry], target)
            extra.unlink()
            path.write_bytes(b"altered")
            with self.assertRaisesRegex(ValueError, "OCR_SOURCE_RETAINED_INVALID"):
                verify_sources([entry], target)
            path.write_bytes(b"different source")
            with self.assertRaisesRegex(ValueError, "OCR_SOURCE_RETAINED_INVALID"):
                verify_sources([entry], target)
            path.unlink()
            with self.assertRaisesRegex(ValueError, "OCR_SOURCE_RETAINED_INVALID"):
                verify_sources([entry], target)

    def test_retained_source_symlink_and_directory_are_rejected(self):
        entry = asset("source.dsc")
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            target = root / "remote"
            target.mkdir()
            path = target / entry["name"]
            path.mkdir()
            with self.assertRaisesRegex(ValueError, "OCR_SOURCE_RETAINED_INVALID"):
                verify_sources([entry], target)
            path.rmdir()
            actual = root / "actual.dsc"
            actual.write_bytes(b"synthetic source")
            try:
                path.symlink_to(actual)
            except OSError as error:
                self.skipTest(f"Symlink creation is unavailable: {error}")
            with self.assertRaisesRegex(ValueError, "OCR_SOURCE_RETAINED_INVALID"):
                verify_sources([entry], target)
