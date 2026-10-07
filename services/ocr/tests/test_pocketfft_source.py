import tempfile
import unittest
import zipfile
from pathlib import Path

from audit_pocketfft import ROOT, REVISION, inspect_archive


class PocketSourceTests(unittest.TestCase):
    def test_retained_source_archive_matches_its_complete_receipt(self):
        path = Path(__file__).resolve().parents[1] / "licenses/sources/PocketFFT.release_for_eigen.zip"
        result = inspect_archive(path)
        self.assertEqual(result["gitArchiveComment"], REVISION)
        self.assertEqual(len(result["files"]), 4)

    def test_corrupt_archive_hash_is_rejected_before_processing(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "source.zip"
            path.write_bytes(b"not-the-pinned-source")
            with self.assertRaisesRegex(ValueError, "OCR_SOURCE_ZIP_HASH_MISMATCH"):
                inspect_archive(path)

    def test_path_escape_and_duplicate_entries_are_rejected(self):
        for names in [(ROOT, ROOT + "../escape.h"), (ROOT, ROOT)]:
            with tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / "source.zip"
                with zipfile.ZipFile(path, "w") as archive:
                    archive.comment = REVISION.encode("ascii")
                    for name in names:
                        archive.writestr(name, b"")
                with self.assertRaisesRegex(ValueError, "OCR_SOURCE_ZIP_LAYOUT_INVALID"):
                    inspect_archive(path, require_archive_hash=False)
