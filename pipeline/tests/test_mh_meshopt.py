import shutil
import subprocess
from pathlib import Path

import numpy as np
import pytest

from asset_pipeline.mh.meshopt import (
    MeshoptError,
    block_elements,
    decode_attributes,
    encode_attributes,
)

WEB = Path(__file__).resolve().parents[2] / "web"


def _official_decoder() -> Path | None:
    """meshoptimizer's own JS decoder, when the web app's dependencies are installed."""
    candidates = sorted((WEB / "node_modules" / ".pnpm").glob("meshoptimizer@*"))
    for candidate in reversed(candidates):
        decoder = candidate / "node_modules" / "meshoptimizer" / "meshopt_decoder.mjs"
        if decoder.is_file():
            return decoder
    return None


def _samples() -> list[tuple[str, np.ndarray, int]]:
    rng = np.random.default_rng(7)
    smooth = np.cumsum(rng.normal(size=(1000, 3)), axis=0).astype(np.float32)
    shorts = np.zeros((5000, 4), dtype=np.int16)
    shorts[1200:1300, :3] = rng.integers(-300, 300, size=(100, 3))
    return [
        ("random bytes", rng.integers(0, 256, size=(777, 12), dtype=np.uint8), 12),
        ("smooth floats", smooth, 12),
        ("sparse shorts", shorts, 8),
        ("all zero", np.zeros((300, 8), dtype=np.uint8), 8),
        ("single element", np.arange(16, dtype=np.uint8), 16),
        ("wide stride", rng.integers(0, 4, size=(70, 64), dtype=np.uint8), 64),
        ("exact block", rng.integers(0, 3, size=(block_elements(4) * 2, 4), dtype=np.uint8), 4),
    ]


@pytest.mark.parametrize(("name", "data", "stride"), _samples(), ids=lambda v: str(v)[:20])
def test_round_trip(name: str, data: np.ndarray, stride: int) -> None:
    raw = np.ascontiguousarray(data).tobytes()
    count = len(raw) // stride
    stream = encode_attributes(raw, stride)
    assert stream[0] == 0xA0
    assert decode_attributes(stream, count, stride) == raw


def test_zero_and_smooth_data_compress() -> None:
    zeros = np.zeros((4096, 8), dtype=np.uint8).tobytes()
    assert len(encode_attributes(zeros, 8)) < len(zeros) / 40
    ramp = np.arange(4096, dtype=np.uint32).tobytes()
    assert len(encode_attributes(ramp, 4)) < len(ramp) / 2


def test_rejects_bad_strides_and_sizes() -> None:
    with pytest.raises(MeshoptError):
        encode_attributes(b"\0" * 12, 6)
    with pytest.raises(MeshoptError):
        encode_attributes(b"\0" * 10, 4)
    with pytest.raises(MeshoptError):
        encode_attributes(b"\0" * 512, 512)
    with pytest.raises(MeshoptError):
        decode_attributes(b"\x00" * 64, 4, 4)


@pytest.mark.skipif(
    shutil.which("node") is None or _official_decoder() is None,
    reason="node or meshoptimizer's JS decoder not installed",
)
def test_official_decoder_reads_our_streams(tmp_path: Path) -> None:
    decoder = _official_decoder()
    assert decoder is not None
    cases = []
    for index, (_, data, stride) in enumerate(_samples()):
        raw = np.ascontiguousarray(data).tobytes()
        (tmp_path / f"{index}.bin").write_bytes(encode_attributes(raw, stride))
        (tmp_path / f"{index}.raw").write_bytes(raw)
        cases.append([index, len(raw) // stride, stride])
    script = tmp_path / "check.mjs"
    script.write_text(
        f"import {{ MeshoptDecoder }} from {decoder.as_uri()!r};\n"
        "import { readFileSync } from 'node:fs';\n"
        "await MeshoptDecoder.ready;\n"
        f"const cases = {cases!r};\n"
        "for (const [index, count, stride] of cases) {\n"
        f"  const source = readFileSync({str(tmp_path)!r} + '/' + index + '.bin');\n"
        f"  const expected = readFileSync({str(tmp_path)!r} + '/' + index + '.raw');\n"
        "  const target = new Uint8Array(count * stride);\n"
        "  MeshoptDecoder.decodeVertexBuffer(target, count, stride, source);\n"
        "  if (Buffer.compare(Buffer.from(target), expected) !== 0) {\n"
        "    console.log('mismatch', index); process.exit(1);\n"
        "  }\n"
        "}\n"
        "console.log('ok');\n",
        encoding="utf-8",
        newline="\n",
    )
    result = subprocess.run(
        ["node", str(script)], capture_output=True, text=True, timeout=60, check=False
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert result.stdout.strip() == "ok"
