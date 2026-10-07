import hashlib
import io
import tarfile
import tempfile
import unittest
from pathlib import Path

from audit_archive import allocated_elf_sections, audit_archive


class ArchiveAuditTests(unittest.TestCase):
    def test_non_elf_is_not_treated_as_native_provenance(self):
        self.assertIsNone(allocated_elf_sections(b'synthetic'))

    def test_invalid_elf_layout_is_rejected(self):
        value = b'\x7fELF\x02\x01' + bytes(58)
        with self.assertRaisesRegex(ValueError, 'OCR_AUDIT_ELF_INVALID'):
            allocated_elf_sections(value)

    def test_audit_matches_library_bytes_without_extracting_paths_or_importing_code(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / 'lib').mkdir()
            (root / 'lib/synthetic.so').write_bytes(b'synthetic library')
            archive = root / 'source.tgz'
            values = {'source/lib/synthetic.so': b'synthetic library',
                      '../LICENSE.txt': b'synthetic license', 'source/ignored.txt': b'ignored'}
            with tarfile.open(archive, 'w:gz') as bundle:
                for name, value in values.items():
                    item = tarfile.TarInfo(name); item.size = len(value)
                    bundle.addfile(item, io.BytesIO(value))
            result = audit_archive(archive, root)
            self.assertTrue(result['source/lib/synthetic.so']['matchesEngine'])
            self.assertEqual(result['../LICENSE.txt']['sha256'],
                             hashlib.sha256(b'synthetic license').hexdigest())
            self.assertNotIn('source/ignored.txt', result)
            self.assertFalse((root / 'LICENSE.txt').exists())

    def test_changed_library_bytes_are_not_certified(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); (root / 'lib').mkdir()
            (root / 'lib/synthetic.so').write_bytes(b'different')
            archive = root / 'source.tgz'
            with tarfile.open(archive, 'w:gz') as bundle:
                item = tarfile.TarInfo('source/lib/synthetic.so'); item.size = 8
                bundle.addfile(item, io.BytesIO(b'original'))
            self.assertFalse(audit_archive(archive, root)['source/lib/synthetic.so']['matchesEngine'])
