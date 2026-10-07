"""Retain pinned corresponding source archives at image-build time.

Archives are hash checked and copied byte for byte. Nothing is extracted,
imported, or executed, and the running OCR service never downloads sources.
"""

import hashlib
import json
import re
import sys
import tempfile
import urllib.parse
import urllib.request
from contextlib import contextmanager
from pathlib import Path

from fetch_engine import fetch_asset


MAX_FILE_BYTES = 100 * 1024 * 1024
MAX_TOTAL_BYTES = 128 * 1024 * 1024
MAX_ARCHIVES = 10
ALLOWED_HOSTS = frozenset({"deb.debian.org", "codeload.github.com"})
NAME_PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9._+-]*\.(?:tar\.gz|tar\.xz|dsc)\Z")
SHA256_PATTERN = re.compile(r"[0-9a-f]{64}\Z")
RESERVED_NAMES = {"CON", "PRN", "AUX", "NUL", *{f"COM{index}" for index in range(1, 10)},
                  *{f"LPT{index}" for index in range(1, 10)}}


def validate_url(value):
    if not isinstance(value, str) or any(ord(character) < 33 for character in value):
        raise ValueError("OCR_SOURCE_URL_INVALID")
    try:
        parsed = urllib.parse.urlsplit(value)
        valid = (parsed.scheme == "https" and parsed.hostname in ALLOWED_HOSTS
                 and parsed.netloc == parsed.hostname and not parsed.username
                 and not parsed.password and "#" not in value and "?" not in value
                 and parsed.path.startswith("/") and "\\" not in urllib.parse.unquote(parsed.path)
                 and not any(part in {".", ".."} for part in
                             urllib.parse.unquote(parsed.path).split("/")))
    except ValueError:
        valid = False
    if not valid:
        raise ValueError("OCR_SOURCE_URL_INVALID")
    return value


def validate_sources(manifest):
    archives = manifest.get("sourceArchives") if isinstance(manifest, dict) else None
    if not isinstance(archives, list) or not 1 <= len(archives) <= MAX_ARCHIVES:
        raise ValueError("OCR_SOURCE_MANIFEST_INVALID")
    names, total = set(), 0
    validated = []
    for asset in archives:
        if not isinstance(asset, dict) or set(asset) != {"name", "url", "bytes", "sha256"}:
            raise ValueError("OCR_SOURCE_MANIFEST_INVALID")
        name = asset["name"]
        if (not isinstance(name, str) or len(name) > 160 or ".." in name
                or name.split(".", 1)[0].upper() in RESERVED_NAMES
                or not NAME_PATTERN.fullmatch(name) or name.casefold() in names):
            raise ValueError("OCR_SOURCE_NAME_INVALID")
        size, digest = asset["bytes"], asset["sha256"]
        if type(size) is not int or not 1 <= size <= MAX_FILE_BYTES:
            raise ValueError("OCR_SOURCE_SIZE_INVALID")
        if not isinstance(digest, str) or not SHA256_PATTERN.fullmatch(digest):
            raise ValueError("OCR_SOURCE_HASH_INVALID")
        validate_url(asset["url"])
        total += size
        if total > MAX_TOTAL_BYTES:
            raise ValueError("OCR_SOURCE_SIZE_INVALID")
        names.add(name.casefold())
        validated.append(dict(asset))
    return validated


def validate_target(value):
    target = Path(value)
    if (not target.is_absolute() or target.name != "ocr-sources"
            or any(part in {".", ".."} for part in target.parts)):
        raise ValueError("OCR_SOURCE_TARGET_INVALID")
    if target.exists() or target.is_symlink():
        raise ValueError("OCR_SOURCE_TARGET_EXISTS")
    for parent in target.parents:
        is_junction = getattr(parent, "is_junction", lambda: False)
        if parent.is_symlink() or is_junction():
            raise ValueError("OCR_SOURCE_TARGET_INVALID")
    if not target.parent.is_dir():
        raise ValueError("OCR_SOURCE_TARGET_INVALID")
    return target


class SourceRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):
        validate_url(new_url)
        return super().redirect_request(request, response, code, message, headers, new_url)


@contextmanager
def source_download_policy():
    # fetch_asset deliberately stays shared with the engine downloader. This
    # standalone, single-threaded build process narrows its redirect policy and
    # restores the prior opener on both successful and failed downloads.
    previous = urllib.request._opener
    urllib.request.install_opener(urllib.request.build_opener(SourceRedirectHandler()))
    try:
        yield
    finally:
        urllib.request.install_opener(previous)


def retain_sources(manifest, destination):
    assets = validate_sources(manifest)
    target = validate_target(destination)
    with tempfile.TemporaryDirectory(prefix=".ocr-sources-", dir=target.parent) as temporary:
        staging = Path(temporary)
        with source_download_policy():
            for asset in assets:
                fetch_asset(asset, staging / asset["name"])
        verify_sources(assets, staging)
        # Build stages download as root; final native checks and the service run
        # as UID 10001. Only completed, verified public source archives become
        # world-readable, with no writable files or directories for other users.
        for asset in assets:
            (staging / asset["name"]).chmod(0o644)
        staging.chmod(0o755)
        # Recheck before publishing the complete set: partial or failed downloads
        # cannot become the source-retention directory.
        validate_target(target)
        staging.rename(target)
    return len(assets)


def verify_sources(assets, destination):
    """Verify the complete source set retained in the final native image."""
    validated = validate_sources({"sourceArchives": assets})
    target = Path(destination)
    if not target.is_absolute() or not target.is_dir():
        raise ValueError("OCR_SOURCE_RETAINED_INVALID")
    for directory in (target, *target.parents):
        is_junction = getattr(directory, "is_junction", lambda: False)
        if directory.is_symlink() or is_junction():
            raise ValueError("OCR_SOURCE_RETAINED_INVALID")
    expected = {asset["name"] for asset in validated}
    if {path.name for path in target.iterdir()} != expected:
        raise ValueError("OCR_SOURCE_RETAINED_INVALID")
    for asset in validated:
        path = target / asset["name"]
        if path.is_symlink() or not path.is_file() or path.stat().st_size != asset["bytes"]:
            raise ValueError("OCR_SOURCE_RETAINED_INVALID")
        digest, size = hashlib.sha256(), 0
        with path.open("rb") as archive:
            while chunk := archive.read(1024 * 1024):
                size += len(chunk)
                if size > asset["bytes"]:
                    raise ValueError("OCR_SOURCE_RETAINED_INVALID")
                digest.update(chunk)
        if size != asset["bytes"] or digest.hexdigest() != asset["sha256"]:
            raise ValueError("OCR_SOURCE_RETAINED_INVALID")
    return len(validated)


def main():
    if len(sys.argv) != 2:
        raise ValueError("OCR_SOURCE_TARGET_INVALID")
    manifest = json.loads(Path(__file__).with_name("native-artifacts.json").read_text(encoding="utf-8"))
    count = retain_sources(manifest, sys.argv[1])
    print(f"OCR_SOURCES_RETAINED: {count} pinned archives")


if __name__ == "__main__":
    main()
