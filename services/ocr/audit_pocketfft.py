"""Inspect the supplied, pinned PocketFFT source ZIP without extracting or running it.

The Git archive comment is recorded provenance, not a publisher signature.
"""
import argparse
import hashlib
import json
import stat
import zipfile
from pathlib import Path

REVISION = "ea778e37710c07723435b1be58235996d1d43a5a"
ARCHIVE_SHA256 = "d3b88763e7e069bab2041e952990c677acda83a19e85ea015eefb1816d7a3344"
ROOT = "pocketfft-release_for_eigen/"
FILES = {
    "LICENSE.md": (1498, "a85ca13fdf90160b64a0698215868c13b74d835ad0a4e2ba44713b8c5058a056"),
    "README.md": (10843, "a65ee672ec3503a34b7e3621f3fe23ee54b51d5e68879b68d2075b085e888501"),
    "pocketfft_demo.cc": (2096, "888f65c7127ac3cf1c56efaf3e7b677536096b359f625671d85338dad6f0485b"),
    "pocketfft_hdronly.h": (110229, "4983075ffefbeaf02e97c9aaac36df44fb59b977ac8bf38c9efdedd9ba3e63bd"),
}


def inspect_archive(path, *, require_archive_hash=True):
    if path.is_symlink() or path.stat().st_size > 512 * 1024:
        raise ValueError("OCR_SOURCE_ZIP_INVALID")
    archive_hash = hashlib.sha256(path.read_bytes()).hexdigest()
    if require_archive_hash and archive_hash != ARCHIVE_SHA256:
        raise ValueError("OCR_SOURCE_ZIP_HASH_MISMATCH")
    try:
        with zipfile.ZipFile(path) as archive:
            members = archive.infolist()
            expected = {ROOT, *(ROOT + name for name in FILES)}
            if len(members) != len(expected) or {m.filename for m in members} != expected:
                raise ValueError("OCR_SOURCE_ZIP_LAYOUT_INVALID")
            if archive.comment != REVISION.encode("ascii"):
                raise ValueError("OCR_SOURCE_ZIP_REVISION_MISMATCH")
            receipts = {}
            for member in members:
                if member.flag_bits & 1 or stat.S_ISLNK(member.external_attr >> 16):
                    raise ValueError("OCR_SOURCE_ZIP_LAYOUT_INVALID")
                if member.filename == ROOT:
                    if not member.is_dir() or member.file_size:
                        raise ValueError("OCR_SOURCE_ZIP_LAYOUT_INVALID")
                    continue
                name = member.filename[len(ROOT):]
                size, digest = FILES[name]
                if member.file_size != size:
                    raise ValueError("OCR_SOURCE_ZIP_SIZE_MISMATCH")
                # ZipFile.read verifies CRC; strict expanded sizes prevent ZIP bombs.
                value = archive.read(member)
                if len(value) != size or hashlib.sha256(value).hexdigest() != digest:
                    raise ValueError("OCR_SOURCE_ZIP_MEMBER_MISMATCH")
                receipts[name] = {"bytes": size, "sha256": digest}
            return {"archiveSha256": archive_hash, "gitArchiveComment": REVISION,
                    "files": receipts}
    except zipfile.BadZipFile as error:
        raise ValueError("OCR_SOURCE_ZIP_INVALID") from error


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    print(json.dumps(inspect_archive(parser.parse_args().archive), indent=2))
