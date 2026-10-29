"""Phone-sized copies of the large KTX2 maps, written with the manifest.

Every texture whose base level is larger than `MAX_SIZE` gets a sibling `<name>.1k.ktx2`:
the same file without its top mip levels, cut byte for byte (no re-encoding), so a phone
samples exactly the texels it sampled before. A phone never draws those levels (the face
spans about 120 px in the face close-up), yet they are three quarters of each file: the
first character's download goes from 70 to 26 MB. `mobile-textures.json` lists the
textures that have a copy; the web app reads it on phones and swaps the URLs in its KTX2
loader (`web/src/lib/assets/textureVariants.ts`).

`write_mobile_textures` is incremental: a copy is rewritten when its source is newer or its
levels no longer match, and copies whose source is gone are deleted.
"""

import json
import struct
from dataclasses import dataclass
from pathlib import Path

MAX_SIZE = 1024
SUFFIX = ".1k.ktx2"
INDEX_FILE = "mobile-textures.json"
INDEX_VERSION = 1

IDENTIFIER = b"\xabKTX 20\xbb\r\n\x1a\n"
HEADER_SIZE = 80
LEVEL_ENTRY = struct.Struct("<3Q")  # byteOffset, byteLength, uncompressedByteLength
# Supercompressed level data has no alignment requirement (KTX2 spec, "Mip Level Array").
UNALIGNED_SCHEMES = {2: "zstd", 3: "zlib"}


class Ktx2LayoutError(ValueError):
    """A KTX2 file this module cannot crop (not 2-D, not supercompressed, or malformed)."""


@dataclass(frozen=True)
class Level:
    offset: int
    length: int
    uncompressed: int


@dataclass(frozen=True)
class Ktx2Layout:
    width: int
    height: int
    levels: tuple[Level, ...]
    dfd: tuple[int, int]  # offset, length
    kvd: tuple[int, int]

    def drop_for(self, max_size: int) -> int:
        """How many top levels to drop so the base fits `max_size` (0: it already does)."""
        drop = 0
        while max(self.width, self.height) >> drop > max_size:
            drop += 1
        return drop

    def needed_bytes(self, drop: int) -> int:
        """File prefix holding the header, metadata and the levels kept after `drop`."""
        ends = [level.offset + level.length for level in self.levels[drop:]]
        return max([*ends, self.kvd[0] + self.kvd[1], self.dfd[0] + self.dfd[1]])


def index_size(head: bytes) -> int:
    """Bytes of header plus level index, read from the header's level count."""
    if len(head) < HEADER_SIZE:
        raise Ktx2LayoutError("truncated KTX2 header")
    (levels,) = struct.unpack_from("<I", head, 40)
    return HEADER_SIZE + LEVEL_ENTRY.size * max(levels, 1)


def read_layout(head: bytes) -> Ktx2Layout:
    """Parse the header and level index (`head` holds at least `index_size(head)` bytes)."""
    if head[:12] != IDENTIFIER:
        raise Ktx2LayoutError("not a KTX2 file")
    _, _, width, height, depth, layers, faces, count, scheme = struct.unpack_from("<9I", head, 12)
    dfd_offset, dfd_length, kvd_offset, kvd_length, _, sgd_length = struct.unpack_from(
        "<4I2Q", head, 48
    )
    if depth or layers or faces != 1:
        raise Ktx2LayoutError("only 2-D textures without layers or faces are cropped")
    if scheme not in UNALIGNED_SCHEMES or sgd_length:
        raise Ktx2LayoutError(f"supercompression scheme {scheme} is not supported")
    if len(head) < index_size(head):
        raise Ktx2LayoutError("truncated level index")
    levels = tuple(
        Level(*LEVEL_ENTRY.unpack_from(head, HEADER_SIZE + LEVEL_ENTRY.size * i))
        for i in range(max(count, 1))
    )
    return Ktx2Layout(width, height, levels, (dfd_offset, dfd_length), (kvd_offset, kvd_length))


def crop_levels(data: bytes, max_size: int = MAX_SIZE) -> bytes | None:
    """The texture without the mip levels larger than `max_size`, or None when nothing is
    dropped (already small enough, or no mip chain to fall back on). `data` may stop after
    the kept levels (`Ktx2Layout.needed_bytes`)."""
    layout = read_layout(data)
    drop = layout.drop_for(max_size)
    if drop == 0 or drop >= len(layout.levels):
        return None
    if len(data) < layout.needed_bytes(drop):
        raise Ktx2LayoutError("truncated level data")
    kept = layout.levels[drop:]

    header = bytearray(data[:HEADER_SIZE])
    struct.pack_into("<2I", header, 20, max(layout.width >> drop, 1), max(layout.height >> drop, 1))
    struct.pack_into("<I", header, 40, len(kept))
    # Same order as the source: index, DFD, KVD, then the level data (smallest level first).
    dfd_offset = HEADER_SIZE + LEVEL_ENTRY.size * len(kept)
    dfd = data[layout.dfd[0] : layout.dfd[0] + layout.dfd[1]]
    kvd = data[layout.kvd[0] : layout.kvd[0] + layout.kvd[1]]
    kvd_offset = dfd_offset + len(dfd) if kvd else 0
    struct.pack_into("<4I2Q", header, 48, dfd_offset, len(dfd), kvd_offset, len(kvd), 0, 0)

    position = dfd_offset + len(dfd) + len(kvd)
    entries: dict[int, Level] = {}
    chunks: list[bytes] = []
    for index in sorted(range(len(kept)), key=lambda i: kept[i].offset):
        level = kept[index]
        entries[index] = Level(position, level.length, level.uncompressed)
        chunks.append(data[level.offset : level.offset + level.length])
        position += level.length
    level_index = b"".join(
        LEVEL_ENTRY.pack(entries[i].offset, entries[i].length, entries[i].uncompressed)
        for i in range(len(kept))
    )
    return bytes(header) + level_index + dfd + kvd + b"".join(chunks)


def variant_path(source: Path) -> Path:
    return source.with_name(source.name.removesuffix(".ktx2") + SUFFIX)


def _read_head(path: Path) -> bytes:
    with path.open("rb") as file:
        head = file.read(HEADER_SIZE)
        return head + file.read(index_size(head) - len(head))


def _variant_current(source: Path, variant: Path, layout: Ktx2Layout, drop: int) -> bool:
    if not variant.is_file() or variant.stat().st_mtime_ns < source.stat().st_mtime_ns:
        return False
    try:
        copy = read_layout(_read_head(variant))
    except Ktx2LayoutError:
        return False
    lengths = [(level.length, level.uncompressed) for level in layout.levels[drop:]]
    return [(level.length, level.uncompressed) for level in copy.levels] == lengths


def crop_file(source: Path, variant: Path, max_size: int = MAX_SIZE) -> bool:
    """Write `variant` from `source`; False when the source needs no copy."""
    layout = read_layout(_read_head(source))
    drop = layout.drop_for(max_size)
    if drop == 0 or drop >= len(layout.levels):
        return False
    with source.open("rb") as file:
        cropped = crop_levels(file.read(layout.needed_bytes(drop)), max_size)
    if cropped is None:
        return False
    temporary = variant.with_name(variant.name + ".tmp")
    temporary.write_bytes(cropped)
    temporary.replace(variant)
    return True


@dataclass
class MobileReport:
    written: int = 0
    current: int = 0
    removed: int = 0
    skipped: int = 0  # textures this module cannot crop (left full size on phones)

    def __str__(self) -> str:
        total = self.written + self.current
        return (
            f"{total} phone copies: {self.written} written, {self.current} up to date, "
            f"{self.removed} removed, {self.skipped} not croppable"
        )


def write_mobile_textures(web: Path, max_size: int = MAX_SIZE) -> MobileReport:
    """Bring the phone copies under `web` up to date and write `mobile-textures.json`."""
    report = MobileReport()
    listed: list[str] = []
    for source in sorted(web.rglob("*.ktx2")):
        if source.name.endswith(SUFFIX):
            if not source.with_name(source.name.removesuffix(SUFFIX) + ".ktx2").is_file():
                source.unlink()
                report.removed += 1
            continue
        variant = variant_path(source)
        try:
            layout = read_layout(_read_head(source))
        except Ktx2LayoutError:
            report.skipped += 1
            continue
        drop = layout.drop_for(max_size)
        if drop == 0 or drop >= len(layout.levels):
            if variant.is_file():
                variant.unlink()
                report.removed += 1
            continue
        if _variant_current(source, variant, layout, drop):
            report.current += 1
        else:
            crop_file(source, variant, max_size)
            report.written += 1
        listed.append(source.relative_to(web).as_posix())

    index = {"version": INDEX_VERSION, "maxSize": max_size, "suffix": SUFFIX, "files": listed}
    path = web / INDEX_FILE
    temporary = path.with_name(path.name + ".tmp")
    # Compact: phones download it before their first texture.
    temporary.write_text(json.dumps(index, separators=(",", ":")) + "\n", encoding="utf-8")
    temporary.replace(path)
    return report
