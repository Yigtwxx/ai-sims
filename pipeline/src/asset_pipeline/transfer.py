"""Archive transfer to the Mac over the local network.

The PC serves the chosen archive folders read-only over HTTP while the transfer
runs (`asset-pipeline serve-slim`); the Mac pulls them with
`pipeline/scripts/fetch_slim.py` (standard library only), in parallel, resuming
partial files with Range requests and checking every file's sha256.

Only files listed in the index are served (no directory listing, no paths from
the request), and every request needs the random token printed at start. The
token never appears in the request log.
"""

from __future__ import annotations

import argparse
import fnmatch
import hashlib
import hmac
import json
import os
import re
import secrets
import socket
import sys
import threading
from dataclasses import dataclass
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import BinaryIO
from urllib.parse import parse_qs, unquote, urlsplit

INDEX_CACHE = ".transfer-index.json"
"""Per-root cache of file hashes, keyed by path, valid while size and mtime match."""

DEFAULT_INCLUDE = ("web", "raw", "fab_anims", "gestures", "logs")
"""Archive folders the Mac needs: web assets, Unreal sources for reconversion, the
retargeted Fab animation sources, the gesture FBX sources (Mocap.in, ActorCore) that
`web/scripts/retarget-fbx.mjs` reads and the run logs. Fab .mhpkg packages (`fab`)
are Unreal-only and stay out unless asked for."""

UNUSED_SOURCES = (
    # Preset exports: Unreal material inputs the converter never opens (traced on a
    # full Ada conversion, 2026-10-21). The 8K wrinkle inputs are grey (the DCC bakes
    # carry the wrinkle maps); the chest maps and the 4K body albedo are inputs too.
    "raw/characters/*/textures/face/T_Face_*_Animated_*",
    "raw/characters/*/textures/body/T_Body_Chest_*",
    "raw/characters/*/textures/body/T_Body_Body_Basecolor.png",
    # Groom FBX exports: the converter reads the glTF twin of every mesh.
    "raw/grooms/*.fbx",
    # Outfit exports (traced on a full outfit conversion, 2026-10-21): the FBX twins of
    # the glTF meshes, and the KhaosMDF322 UDIM tiles its UVs never reach (the shared
    # Size6 texture set ships 34 tiles; the garment lies on 1001 and 1002).
    "raw/outfits/*/*/*.fbx",
    "raw/outfits/*/WI_KhaosMDF322/textures/*.100[3-9].png",
    "raw/outfits/*/WI_KhaosMDF322/textures/*.10[1-9]?.png",
    # MetaHuman Creator's skin-region masks (uncompressed 8K TGA), only used by its
    # own texture synthesis.
    "raw/statics/MetaHumanCharacter/Lookdev_UHM/Skin/*",
)
"""Archive files left out of the transfer unless `--everything` is given: exported but
never read by `asset_pipeline.mh` (the converter), so the Mac can rebuild every web
asset without them. Patterns are fnmatch globs on the POSIX path from the root."""

CHUNK = 1 << 20
RANGE = re.compile(r"^bytes=(\d*)-(\d*)$")


@dataclass(frozen=True)
class IndexedFile:
    path: str  # POSIX, relative to the root
    size: int
    sha256: str


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(CHUNK):
            digest.update(chunk)
    return digest.hexdigest()


def is_excluded(relative: str, exclude: tuple[str, ...]) -> bool:
    return any(fnmatch.fnmatchcase(relative, pattern) for pattern in exclude)


def build_index(
    root: Path, include: tuple[str, ...], exclude: tuple[str, ...] = ()
) -> list[IndexedFile]:
    """Every regular file under the included top-level folders that no `exclude`
    pattern matches, hashed once and re-hashed only when its size or mtime changes."""
    cache_path = root / INDEX_CACHE
    try:
        cache: dict[str, dict[str, int | str]] = json.loads(cache_path.read_text("utf-8"))
    except (OSError, ValueError):
        cache = {}
    files: list[IndexedFile] = []
    fresh: dict[str, dict[str, int | str]] = {}
    for name in include:
        top = root / name
        if not top.is_dir():
            continue
        for path in sorted(p for p in top.rglob("*") if p.is_file() and not p.is_symlink()):
            relative = path.relative_to(root).as_posix()
            if is_excluded(relative, exclude):
                continue
            stat = path.stat()
            entry = cache.get(relative)
            if entry and entry["size"] == stat.st_size and entry["mtime"] == stat.st_mtime_ns:
                digest = str(entry["sha256"])
            else:
                digest = sha256_of(path)
            fresh[relative] = {"size": stat.st_size, "mtime": stat.st_mtime_ns, "sha256": digest}
            files.append(IndexedFile(relative, stat.st_size, digest))
    cache_path.write_text(json.dumps(fresh), "utf-8")
    return files


def parse_range(header: str | None, size: int) -> tuple[int, int] | None:
    """(first, last) byte of a single `bytes=a-b` range, None for a whole-file
    request. Raises ValueError for ranges that cannot be satisfied."""
    if not header:
        return None
    match = RANGE.match(header.strip())
    if not match or (not match[1] and not match[2]):
        raise ValueError(header)
    if not match[1]:  # suffix: the last N bytes
        length = int(match[2])
        if length == 0:
            raise ValueError(header)
        return max(0, size - length), size - 1
    first = int(match[1])
    last = int(match[2]) if match[2] else size - 1
    if first >= size or last < first:
        raise ValueError(header)
    return first, min(last, size - 1)


def lan_address() -> str:
    """The address other machines on the network reach this one at (no packet is sent)."""
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
        try:
            probe.connect(("10.255.255.255", 1))
            return str(probe.getsockname()[0])
        except OSError:
            return "127.0.0.1"


class TransferServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(
        self, address: tuple[str, int], root: Path, files: list[IndexedFile], token: str
    ) -> None:
        super().__init__(address, TransferHandler)
        self.root = root.resolve()
        self.files = {f.path: f for f in files}
        self.token = token
        self.listing = json.dumps(
            {"files": [vars(f) for f in files], "total": sum(f.size for f in files)}
        ).encode("utf-8")


class TransferHandler(BaseHTTPRequestHandler):
    server: TransferServer
    protocol_version = "HTTP/1.1"

    def log_message(self, format: str, *args: object) -> None:
        # The default line carries the query string, and with it the token.
        sys.stderr.write(f"{self.address_string()} {self.command} {urlsplit(self.path).path}\n")

    def _authorized(self) -> bool:
        header = self.headers.get("Authorization", "")
        query = parse_qs(urlsplit(self.path).query).get("token", [""])[0]
        offered = header.removeprefix("Bearer ").strip() if header.startswith("Bearer ") else query
        return hmac.compare_digest(offered.encode(), self.server.token.encode())

    def _fail(self, status: HTTPStatus) -> None:
        self.send_response(status)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self) -> None:
        self._serve(body=True)

    def do_HEAD(self) -> None:
        self._serve(body=False)

    def _serve(self, *, body: bool) -> None:
        if not self._authorized():
            self._fail(HTTPStatus.UNAUTHORIZED)
            return
        route = urlsplit(self.path).path
        if route == "/files.json":
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(self.server.listing)))
            self.end_headers()
            if body:
                self.wfile.write(self.server.listing)
            return
        entry = self.server.files.get(unquote(route.removeprefix("/f/")))
        if not route.startswith("/f/") or entry is None:
            self._fail(HTTPStatus.NOT_FOUND)
            return
        try:
            stream = (self.server.root / entry.path).open("rb")
        except OSError:
            stream = None
        if stream is None or os.fstat(stream.fileno()).st_size != entry.size:
            # Deleted or rewritten on the PC after indexing (a prune or a conversion run
            # while serving): the indexed hash no longer describes it.
            if stream:
                stream.close()
            self._fail(HTTPStatus.GONE)
            return
        with stream:
            self._send_file(stream, entry, body=body)

    def _send_file(self, stream: BinaryIO, entry: IndexedFile, *, body: bool) -> None:
        try:
            span = parse_range(self.headers.get("Range"), entry.size)
        except ValueError:
            self.send_response(HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
            self.send_header("Content-Range", f"bytes */{entry.size}")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        first, last = span if span else (0, entry.size - 1)
        length = max(0, last - first + 1)
        self.send_response(HTTPStatus.PARTIAL_CONTENT if span else HTTPStatus.OK)
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Content-Length", str(length))
        self.send_header("Accept-Ranges", "bytes")
        if span:
            self.send_header("Content-Range", f"bytes {first}-{last}/{entry.size}")
        self.end_headers()
        if not body or length == 0:
            return
        stream.seek(first)
        remaining = length
        while remaining > 0:
            chunk = stream.read(min(CHUNK, remaining))
            if not chunk:
                break
            self.wfile.write(chunk)
            remaining -= len(chunk)


def start_server(
    root: Path,
    include: tuple[str, ...],
    host: str,
    port: int,
    token: str | None = None,
    exclude: tuple[str, ...] = (),
) -> tuple[TransferServer, threading.Thread]:
    """Indexes and starts serving in a background thread (tests, `serve`)."""
    files = build_index(root, include, exclude)
    # 64 random bits as lowercase hex: typed by hand on the Mac, so no 0/O or l/I mix-ups,
    # and far beyond guessing over a LAN while the transfer runs.
    server = TransferServer((host, port), root, files, token or secrets.token_hex(8))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, thread


def serve(
    root: Path, include: tuple[str, ...], exclude: tuple[str, ...], host: str | None, port: int
) -> int:
    host = host or lan_address()
    print(f"indexing {', '.join(include)} under {root} (hashes are cached) ...", flush=True)
    if exclude:
        print(f"leaving out {len(exclude)} unused source patterns (--everything keeps them)")
    server, thread = start_server(root, include, host, port, exclude=exclude)
    total = sum(f.size for f in server.files.values())
    unique = sum({f.sha256: f.size for f in server.files.values()}.values())
    actual_port = server.server_address[1]
    print(
        f"serving {len(server.files)} files, {total / 1e9:.1f} GB "
        f"({unique / 1e9:.1f} GB to download, identical files once) on http://{host}:{actual_port}"
    )
    print("on the Mac (same network), from the repo root (caffeinate keeps it awake):")
    print(
        f"  caffeinate -i python3 pipeline/scripts/fetch_slim.py --url http://{host}:{actual_port} "
        f"--token {server.token} --dest ~/MetaHumanArchive"
    )
    print("Ctrl+C stops the server once the Mac reports 'all files verified'.", flush=True)
    try:
        wait_for_interrupt(thread)
    except KeyboardInterrupt:
        server.shutdown()
        print("server stopped")
    return 0


def wait_for_interrupt(thread: threading.Thread, poll: float = 0.5) -> None:
    """Blocks while `thread` runs. Joins in short slices: on Windows an untimed join
    is not interrupted by Ctrl+C, so the server would never stop."""
    while thread.is_alive():
        thread.join(poll)


def add_parser(subparsers: argparse._SubParsersAction[argparse.ArgumentParser]) -> None:
    parser = subparsers.add_parser(
        "serve-slim", help="Serve the archive to the Mac over the LAN (token, Range, sha256)"
    )
    parser.add_argument("--archive", type=Path, help="MetaHumanArchive root (default: $MH_ARCHIVE)")
    parser.add_argument(
        "--include",
        default=",".join(DEFAULT_INCLUDE),
        help=f"top-level folders to serve (default: {','.join(DEFAULT_INCLUDE)})",
    )
    parser.add_argument(
        "--everything",
        action="store_true",
        help="also serve the exported files the converter never reads (UNUSED_SOURCES)",
    )
    parser.add_argument("--bind", help="address to listen on (default: this PC's LAN address)")
    parser.add_argument("--port", type=int, default=8765)


def run(args: argparse.Namespace) -> int:
    root = args.archive or Path(os.environ.get("MH_ARCHIVE", Path.home() / "MetaHumanArchive"))
    include = tuple(part.strip() for part in args.include.split(",") if part.strip())
    exclude = () if args.everything else UNUSED_SOURCES
    return serve(root, include, exclude, args.bind, args.port)
