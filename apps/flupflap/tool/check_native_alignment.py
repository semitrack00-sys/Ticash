"""Check 64-bit native ELF alignment and APK mmap packaging without extraction."""
import argparse
import json
from pathlib import PurePosixPath
import struct
import zipfile


PAGE_SIZE = 16384


def check_elf(data):
    if len(data) < 64 or data[:5] != b'\x7fELF\x02' or data[5] not in (1, 2):
        raise ValueError('Invalid 64-bit native ELF header.')
    endian = '<' if data[5] == 1 else '>'
    offset = struct.unpack_from(endian + 'Q', data, 32)[0]
    size, count = struct.unpack_from(endian + 'HH', data, 54)
    if size < 56 or not count or offset < 64 or offset + size * count > len(data):
        raise ValueError('Invalid ELF program header table.')
    loads = 0
    for index in range(count):
        header = offset + index * size
        if struct.unpack_from(endian + 'I', data, header)[0] != 1:
            continue
        loads += 1
        file_offset, address = struct.unpack_from(endian + 'QQ', data, header + 8)
        alignment = struct.unpack_from(endian + 'Q', data, header + 48)[0]
        if (alignment < PAGE_SIZE or alignment & (alignment - 1)
                or (address - file_offset) % PAGE_SIZE):
            raise ValueError('Native ELF load segment is not 16 KB compatible.')
    if not loads:
        raise ValueError('Native ELF has no loadable segments.')


def check_archive(path, bundle=False):
    checked = []
    with open(path, 'rb') as source, zipfile.ZipFile(path) as archive:
        for entry in archive.infolist():
            parts = PurePosixPath(entry.filename).parts
            if not entry.filename.endswith('.so') or 'lib' not in parts:
                continue
            index = parts.index('lib')
            if len(parts) <= index + 2 or parts[index + 1] not in ('arm64-v8a', 'x86_64'):
                continue
            check_elf(archive.read(entry))
            if not bundle:
                if entry.compress_type != zipfile.ZIP_STORED:
                    raise ValueError('APK native library must be uncompressed for mmap loading.')
                source.seek(entry.header_offset)
                header = source.read(30)
                if len(header) != 30 or header[:4] != b'PK\x03\x04':
                    raise ValueError('Invalid APK local ZIP header.')
                name_size, extra_size = struct.unpack_from('<HH', header, 26)
                data_offset = entry.header_offset + 30 + name_size + extra_size
                if data_offset % PAGE_SIZE:
                    raise ValueError('APK native library data is not ZIP-aligned to 16 KB.')
            checked.append(entry.filename)
    if not any('/arm64-v8a/' in name for name in checked):
        raise ValueError('Archive contains no arm64 native libraries.')
    return {'archive_type': 'AAB' if bundle else 'APK',
            'native_64bit_libraries': len(checked), 'static_16kb_alignment': 'passed'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('archive')
    parser.add_argument('--bundle', action='store_true', help='AAB: inspect ELF only; APKs also require ZIP alignment.')
    args = parser.parse_args()
    try:
        print(json.dumps(check_archive(args.archive, args.bundle)))
    except (ValueError, OSError, zipfile.BadZipFile, struct.error):
        parser.exit(1, 'Native library alignment check failed.\n')
