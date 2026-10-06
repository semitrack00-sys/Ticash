import struct
import tempfile
import unittest
from pathlib import Path
import zipfile
from check_native_alignment import check_archive, check_elf


def elf(alignment=16384, address=0):
    data = bytearray(120)
    data[:6] = b'\x7fELF\x02\x01'
    struct.pack_into('<Q', data, 32, 64)
    struct.pack_into('<HH', data, 54, 56, 1)
    struct.pack_into('<I', data, 64, 1)
    struct.pack_into('<QQ', data, 72, 0, address)
    struct.pack_into('<Q', data, 112, alignment)
    return data


class NativeAlignmentTest(unittest.TestCase):
    def test_load_segments_require_valid_16kb_alignment(self):
        check_elf(elf())
        check_elf(elf(65536))
        for data in (elf(4096), elf(20000), elf(address=4096), elf()[:100], b'not-elf'):
            with self.subTest(data=data[:6]), self.assertRaises(ValueError):
                check_elf(data)

    def test_apk_zip_alignment_and_bundle_compression(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'artifact.zip'
            name = 'lib/arm64-v8a/libsample.so'
            info = zipfile.ZipInfo(name)
            padding = (-(30 + len(name))) % 16384
            info.extra = b'\xfe\xca' + struct.pack('<H', padding - 4) + bytes(padding - 4)
            with zipfile.ZipFile(path, 'w') as archive:
                archive.writestr(info, elf())
            self.assertEqual(check_archive(path)['native_64bit_libraries'], 1)
            with zipfile.ZipFile(path, 'w') as archive:
                archive.writestr(name, elf())
            with self.assertRaises(ValueError): check_archive(path)
            self.assertEqual(check_archive(path, bundle=True)['archive_type'], 'AAB')
            with zipfile.ZipFile(path, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
                archive.writestr('base/' + name, elf())
            with self.assertRaises(ValueError): check_archive(path)
            check_archive(path, bundle=True)

    def test_missing_arm64_and_misaligned_bundle_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'artifact.aab'
            for name, data in [('base/lib/x86_64/libsample.so', elf()),
                               ('base/lib/arm64-v8a/libsample.so', elf(4096))]:
                with zipfile.ZipFile(path, 'w') as archive:
                    archive.writestr(name, data)
                with self.subTest(name=name), self.assertRaises(ValueError):
                    check_archive(path, bundle=True)
