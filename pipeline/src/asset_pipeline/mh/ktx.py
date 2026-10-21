"""KTX2 encoding with KTX-Software's `ktx create` (UASTC + zstd, mipmaps).

The tool is found through `$KTX_TOOLS` (a directory holding `ktx`/`ktx.exe`), then `PATH`,
then the default per-user install (`~/tools/ktx/<version>/bin`). Images are handed over as
temporary PNGs; the transfer function is always assigned explicitly so a PNG's colour
chunks never trigger a conversion.

UASTC was chosen over ETC1S after measuring Ada's 4K maps: ETC1S shifted skin hue by up to
37 levels (UASTC at RDO 1.0: 15) and doubled the normal-map angular error.
"""

import os
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

import numpy as np
from numpy.typing import NDArray
from PIL import Image

KTX_TOOLS_ENV = "KTX_TOOLS"
KTX_THREADS_ENV = "MH_KTX_THREADS"  # optional cap on encoder threads (output quality unchanged)
KTX_VERSION = "4.4.2"
FORMATS = {1: "R8", 2: "R8G8", 3: "R8G8B8", 4: "R8G8B8A8"}


class KtxUnavailableError(RuntimeError):
    """KTX-Software's `ktx` tool is not installed."""


class KtxEncodeError(RuntimeError):
    """`ktx create` failed."""


def ktx_executable() -> Path:
    name = "ktx.exe" if sys.platform == "win32" else "ktx"
    candidates = []
    if os.environ.get(KTX_TOOLS_ENV):
        candidates.append(Path(os.environ[KTX_TOOLS_ENV]) / name)
    found = shutil.which("ktx")
    if found:
        candidates.append(Path(found))
    candidates.append(Path.home() / "tools" / "ktx" / KTX_VERSION / "bin" / name)
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    raise KtxUnavailableError(
        f"KTX-Software {KTX_VERSION} not found: install it or set ${KTX_TOOLS_ENV}"
    )


def is_available() -> bool:
    try:
        ktx_executable()
    except KtxUnavailableError:
        return False
    return True


@dataclass(frozen=True)
class Ktx2Settings:
    """How one texture role is encoded (UASTC, optional RDO, zstd, full mip chain)."""

    transfer: Literal["srgb", "linear"]
    rdo: float | None = 1.0
    quality: int = 1
    zstd: int = 18
    mipmaps: bool = True
    wrap: bool = False  # mipmaps filtered as a tiling texture (repeat at the edges)

    def arguments(self, channels: int) -> list[str]:
        suffix = "_SRGB" if self.transfer == "srgb" else "_UNORM"
        args = [
            "--format",
            FORMATS[channels] + suffix,
            "--assign-tf",
            self.transfer,
            "--encode",
            "uastc",
            "--uastc-quality",
            str(self.quality),
        ]
        if self.rdo:
            args += ["--uastc-rdo", "--uastc-rdo-l", f"{self.rdo:g}"]
        args += ["--zstd", str(self.zstd)]
        if self.mipmaps:
            args.append("--generate-mipmap")
            if self.wrap:
                args += ["--mipmap-wrap", "wrap"]
        threads = os.environ.get(KTX_THREADS_ENV, "").strip()
        if threads.isdigit() and int(threads) > 0:
            args += ["--threads", threads]
        return args

    @property
    def key(self) -> str:
        key = f"uastc-q{self.quality}-rdo{self.rdo}-z{self.zstd}-{self.transfer}-mip{self.mipmaps}"
        return f"{key}-wrap" if self.wrap else key


def encode_ktx2(image: NDArray[np.uint8], output: Path, settings: Ktx2Settings) -> int:
    """Encode an `(H, W)` or `(H, W, C)` uint8 image; returns the KTX2 file size."""
    if image.dtype != np.uint8:
        raise TypeError("encode_ktx2 expects uint8 pixels")
    pixels = image if image.ndim == 3 else image[..., None]
    channels = pixels.shape[2]
    if channels not in FORMATS:
        raise ValueError(f"{channels} channels cannot be encoded")
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="mh-ktx-") as scratch:
        source = Path(scratch) / "image.png"
        # 2-D -> L, (H, W, 2) -> LA, 3 -> RGB, 4 -> RGBA.
        Image.fromarray(np.ascontiguousarray(pixels[..., 0] if channels == 1 else pixels)).save(
            source, compress_level=1
        )
        temporary = output.with_suffix(".ktx2.tmp")
        command = [
            str(ktx_executable()),
            "create",
            *settings.arguments(channels),
            str(source),
            str(temporary),
        ]
        result = subprocess.run(command, capture_output=True, text=True, check=False)
        if result.returncode != 0 or not temporary.is_file():
            raise KtxEncodeError(
                f"ktx create failed for {output.name}: {result.stderr.strip()[-500:]}"
            )
        temporary.replace(output)
    return output.stat().st_size
