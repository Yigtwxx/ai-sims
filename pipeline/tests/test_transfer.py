"""LAN transfer: the token-guarded Range server and the resuming, verifying client."""

import importlib.util
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

import pytest

from asset_pipeline.transfer import build_index, parse_range, start_server

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "fetch_slim.py"
spec = importlib.util.spec_from_file_location("fetch_slim", SCRIPT)
assert spec and spec.loader
fetch_slim = importlib.util.module_from_spec(spec)
# dataclasses look their module up in sys.modules.
sys.modules["fetch_slim"] = fetch_slim
spec.loader.exec_module(fetch_slim)

TOKEN = "test-token"


@pytest.fixture
def archive(tmp_path: Path) -> Path:
    root = tmp_path / "archive"
    (root / "web" / "faces" / "Ada").mkdir(parents=True)
    (root / "web" / "faces" / "Ada" / "head.glb").write_bytes(bytes(range(256)) * 4096)
    (root / "web" / "manifest.json").write_text('{"version": 2}', "utf-8")
    (root / "fab").mkdir()
    (root / "fab" / "pack.mhpkg").write_bytes(b"unreal only")
    return root


@pytest.fixture
def server(archive: Path):
    instance, _ = start_server(archive, ("web",), "127.0.0.1", 0, TOKEN)
    yield instance
    instance.shutdown()
    instance.server_close()


def url_of(server) -> str:
    host, port = server.server_address[:2]
    return f"http://{host}:{port}"


def test_build_index_lists_only_included_folders_with_hashes(archive: Path):
    files = build_index(archive, ("web",))
    assert [f.path for f in files] == ["web/faces/Ada/head.glb", "web/manifest.json"]
    assert all(len(f.sha256) == 64 for f in files), "Expected sha256 hex digests"


def test_build_index_reuses_cached_hashes(archive: Path):
    first = build_index(archive, ("web",))
    cache = json.loads((archive / ".transfer-index.json").read_text("utf-8"))
    cache["web/manifest.json"]["sha256"] = "cached"
    (archive / ".transfer-index.json").write_text(json.dumps(cache), "utf-8")
    second = build_index(archive, ("web",))
    assert second[1].sha256 == "cached", "Expected the unchanged file's cached hash"
    assert second[0] == first[0]


@pytest.mark.parametrize(
    ("header", "expected"),
    [(None, None), ("bytes=0-9", (0, 9)), ("bytes=10-", (10, 99)), ("bytes=-5", (95, 99))],
)
def test_parse_range_reads_single_ranges(header, expected):
    assert parse_range(header, 100) == expected


@pytest.mark.parametrize("header", ["bytes=100-", "bytes=5-2", "items=0-1", "bytes=-"])
def test_parse_range_rejects_unsatisfiable_ranges(header):
    with pytest.raises(ValueError):
        parse_range(header, 100)


def test_server_rejects_requests_without_the_token(server):
    with pytest.raises(urllib.error.HTTPError) as error:
        urllib.request.urlopen(f"{url_of(server)}/files.json", timeout=5)
    assert error.value.code == 401


def test_server_serves_only_indexed_files(server):
    client = fetch_slim.Client(url_of(server), TOKEN)
    for route in ["/f/fab/pack.mhpkg", "/f/../outside.txt", "/f/web"]:
        with pytest.raises(urllib.error.HTTPError) as error:
            urllib.request.urlopen(client._request(route), timeout=5)
        assert error.value.code == 404, f"Expected 404 for {route}"


def test_server_answers_range_requests(server):
    client = fetch_slim.Client(url_of(server), TOKEN)
    with urllib.request.urlopen(client._request("/f/web/manifest.json", 3), timeout=5) as reply:
        assert reply.status == 206
        assert reply.read() == b'ersion": 2}'


def test_fetch_downloads_verifies_and_skips_complete_files(server, tmp_path: Path):
    client = fetch_slim.Client(url_of(server), TOKEN)
    dest = tmp_path / "mac"
    outcomes = [client.fetch(f, dest) for f in client.files()]
    assert outcomes == ["downloaded", "downloaded"]
    source = server.root / "web" / "faces" / "Ada" / "head.glb"
    assert (dest / "web" / "faces" / "Ada" / "head.glb").read_bytes() == source.read_bytes()
    assert [client.fetch(f, dest) for f in client.files()] == ["skipped", "skipped"]


def test_fetch_resumes_a_partial_file(server, tmp_path: Path):
    client = fetch_slim.Client(url_of(server), TOKEN)
    remote = next(f for f in client.files() if f.path.endswith("head.glb"))
    target = tmp_path / "mac" / "web" / "faces" / "Ada" / "head.glb"
    target.parent.mkdir(parents=True)
    source = (server.root / remote.path).read_bytes()
    target.with_name("head.glb.part").write_bytes(source[:300_000])
    assert client.fetch(remote, tmp_path / "mac") == "downloaded"
    assert target.read_bytes() == source


def test_safe_target_refuses_paths_outside_the_destination(tmp_path: Path):
    for bad in ["../x", "/etc/passwd", "web/../../x"]:
        with pytest.raises(ValueError):
            fetch_slim.safe_target(tmp_path, bad)
