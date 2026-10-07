"""Offline dependency provenance evidence; never imports or executes native code.

Read trusted build archives without extracting paths. This is an audit helper,
not a claim that matching a binary hash completes its license review.
"""

import argparse
import hashlib
import json
import struct
import tarfile
from pathlib import Path


def allocated_elf_sections(value):
    """Hash every file-backed SHF_ALLOC section, ignoring stripped debug data.

    Evidence only: this does not certify a license or permit an unknown binary.
    """
    if value[:6] != b"\x7fELF\x02\x01" or len(value) < 64:
        return None
    offset = struct.unpack_from("<Q", value, 40)[0]
    entry_size, count, names_index = struct.unpack_from("<HHH", value, 58)
    if entry_size != 64 or count > 1000 or names_index >= count or offset + count * 64 > len(value):
        raise ValueError("OCR_AUDIT_ELF_INVALID")
    entries = [struct.unpack_from("<IIQQQQIIQQ", value, offset + i * 64) for i in range(count)]
    names_start, names_size = entries[names_index][4:6]
    names = value[names_start:names_start + names_size]
    sections = {}
    for name_start, kind, flags, _, start, size, *_ in entries:
        if flags & 2 and kind != 8:
            if start + size > len(value) or name_start >= len(names):
                raise ValueError("OCR_AUDIT_ELF_INVALID")
            name = names[name_start:].split(b"\0", 1)[0].decode("ascii")
            sections[name] = hashlib.sha256(value[start:start + size]).hexdigest()
    return sections


def audit_archive(archive, engine):
    libraries = {p.name: p for p in (engine / "lib").iterdir() if p.is_file()}
    observed = {}
    with tarfile.open(archive, "r|gz") as bundle:
        count = size = 0
        for member in bundle:
            count += 1
            size += max(0, member.size)
            if count > 30000 or size > 2 * 1024**3:
                raise ValueError("OCR_AUDIT_ARCHIVE_TOO_LARGE")
            if not member.isfile():
                continue
            name = Path(member.name).name
            is_notice = any(word in name.lower() for word in ("license", "notice", "copyright", "third-party"))
            if name not in libraries and not is_notice:
                continue
            if is_notice and member.size > 1024 * 1024:
                raise ValueError("OCR_AUDIT_NOTICE_TOO_LARGE")
            if member.size > 180 * 1024 * 1024:
                raise ValueError("OCR_AUDIT_LIBRARY_TOO_LARGE")
            source = bundle.extractfile(member)
            digest = hashlib.sha256()
            chunks = []
            while chunk := source.read(1024 * 1024):
                digest.update(chunk)
                if name in libraries:
                    chunks.append(chunk)
            record = {"bytes": member.size, "sha256": digest.hexdigest()}
            if name in libraries:
                local_bytes = libraries[name].read_bytes()
                local = hashlib.sha256(local_bytes).hexdigest()
                record["matchesEngine"] = local == digest.hexdigest()
                upstream_sections = allocated_elf_sections(b"".join(chunks))
                engine_sections = allocated_elf_sections(local_bytes)
                if upstream_sections and engine_sections:
                    record["allocatedSectionsMatch"] = upstream_sections == engine_sections
                    record["differentAllocatedSections"] = [section for section in
                        sorted(set(upstream_sections) | set(engine_sections))
                        if upstream_sections.get(section) != engine_sections.get(section)]
            observed[member.name] = record
    return observed


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("engine", type=Path)
    args = parser.parse_args()
    print(json.dumps(audit_archive(args.archive, args.engine), indent=2))


if __name__ == "__main__":
    main()
