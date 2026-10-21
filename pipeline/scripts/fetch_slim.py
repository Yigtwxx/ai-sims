"""Pull the MetaHuman archive from the PC (`asset-pipeline serve-slim`) onto this machine.

Standard library only, so it runs before `uv sync`:

    python3 pipeline/scripts/fetch_slim.py --url http://<pc>:8765 --token <token> \\
        --dest ~/MetaHumanArchive

Files download in parallel into `<file>.part` and resume from where they stopped
(HTTP Range); each one is checked against the server's sha256 before it takes its
final name. Re-running skips files that are already complete, so an interrupted
transfer is simply started again. The token is sent as a header, never in a URL.

Byte-identical files (an outfit's textures under both genders, the underwear maps every
preset carries) download once; the other paths are made locally from that copy: hard
links for the sources, real copies under `web/`, whose files the converter rewrites in
place (a rewrite through one hard link would change its twins too).
"""

from __future__ import annotations

import argparse
import hashlib
import http.client
import json
import os
import shutil
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from urllib.parse import quote

CHUNK = 1 << 20
ATTEMPTS = 5
GONE = 410
"""serve-slim's answer for a file deleted or rewritten on the PC after it started."""
COPIED = ("web/",)
"""Path prefixes copied instead of hard-linked when either side of a duplicate is under one
(see the docstring)."""


@dataclass(frozen=True)
class RemoteFile:
    path: str
    size: int
    sha256: str


def safe_target(dest: Path, relative: str) -> Path:
    """Destination of a served path; refuses absolute paths and `..` components."""
    posix = PurePosixPath(relative)
    if posix.is_absolute() or ".." in posix.parts or not posix.parts:
        raise ValueError(f"unsafe path from server: {relative!r}")
    return dest.joinpath(*posix.parts)


def dedupe(files: list[RemoteFile]) -> tuple[list[RemoteFile], list[tuple[RemoteFile, RemoteFile]]]:
    """The first file of every distinct content, and (twin, original) pairs for the rest."""
    originals: dict[str, RemoteFile] = {}
    twins: list[tuple[RemoteFile, RemoteFile]] = []
    for remote in files:
        original = originals.setdefault(remote.sha256, remote)
        if original is not remote:
            twins.append((remote, original))
    return list(originals.values()), twins


def is_complete(target: Path, remote: RemoteFile) -> bool:
    return (
        target.is_file()
        and target.stat().st_size == remote.size
        and sha256_of(target) == remote.sha256
    )


def place_twin(remote: RemoteFile, original: RemoteFile, dest: Path) -> str:
    """Makes `remote` from the already downloaded `original` (same content).
    Returns 'skipped', 'linked' or 'copied'."""
    target = safe_target(dest, remote.path)
    if is_complete(target, remote):
        return "skipped"
    source = safe_target(dest, original.path)
    target.parent.mkdir(parents=True, exist_ok=True)
    part = target.with_name(target.name + ".part")
    part.unlink(missing_ok=True)
    outcome = "copied"
    if not remote.path.startswith(COPIED) and not original.path.startswith(COPIED):
        try:
            os.link(source, part)
            outcome = "linked"
        except OSError:  # no hard links on this volume
            pass
    if outcome == "copied":
        shutil.copyfile(source, part)
    part.replace(target)
    return outcome


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(CHUNK):
            digest.update(chunk)
    return digest.hexdigest()


class ChangedOnServer(Exception):
    def __init__(self, path: str) -> None:
        super().__init__(f"changed on the PC since serve-slim started: {path}")


class Client:
    def __init__(self, url: str, token: str, timeout: float = 60) -> None:
        self.url = url.rstrip("/")
        self.token = token
        self.timeout = timeout

    def _request(self, route: str, start: int = 0) -> urllib.request.Request:
        request = urllib.request.Request(f"{self.url}{route}")
        request.add_header("Authorization", f"Bearer {self.token}")
        if start:
            request.add_header("Range", f"bytes={start}-")
        return request

    def files(self) -> list[RemoteFile]:
        with urllib.request.urlopen(self._request("/files.json"), timeout=self.timeout) as reply:
            listing = json.load(reply)
        return [RemoteFile(f["path"], int(f["size"]), f["sha256"]) for f in listing["files"]]

    def fetch(self, remote: RemoteFile, dest: Path) -> str:
        """Downloads one file (resuming), verifies it and moves it into place.
        Returns 'skipped', 'downloaded' or raises after ATTEMPTS failures."""
        target = safe_target(dest, remote.path)
        if is_complete(target, remote):
            return "skipped"
        target.unlink(missing_ok=True)
        target.parent.mkdir(parents=True, exist_ok=True)
        part = target.with_name(target.name + ".part")
        if part.is_file() and part.stat().st_nlink > 1:
            # Left by a twin that was being linked: appending to it would write into its source.
            part.unlink()
        for attempt in range(1, ATTEMPTS + 1):
            try:
                start = part.stat().st_size if part.is_file() else 0
                if start > remote.size:
                    part.unlink()
                    start = 0
                # An empty file still needs one request to create its `.part`.
                if start < remote.size or not part.is_file():
                    route = "/f/" + quote(remote.path)
                    with urllib.request.urlopen(
                        self._request(route, start), timeout=self.timeout
                    ) as reply:
                        # A server that ignored the range sends the whole file again.
                        mode = "ab" if start and reply.status == 206 else "wb"
                        with part.open(mode) as out:
                            while chunk := reply.read(CHUNK):
                                out.write(chunk)
                if sha256_of(part) != remote.sha256:
                    part.unlink()
                    raise OSError(f"sha256 mismatch for {remote.path}")
                part.replace(target)
                return "downloaded"
            except (OSError, http.client.HTTPException) as error:
                if isinstance(error, urllib.error.HTTPError) and error.code == GONE:
                    # Retrying cannot help; a restarted (re-indexed) server can.
                    raise ChangedOnServer(remote.path) from None
                if attempt == ATTEMPTS:
                    raise
                print(f"retry {attempt}/{ATTEMPTS - 1} {remote.path}: {error}", file=sys.stderr)
                time.sleep(min(30, 2**attempt))
        raise AssertionError("unreachable")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--url", required=True, help="http://<pc address>:<port>")
    parser.add_argument("--token", required=True, help="token printed by serve-slim")
    parser.add_argument("--dest", type=Path, required=True, help="archive root on this machine")
    parser.add_argument("--jobs", type=int, default=6, help="parallel downloads")
    parser.add_argument("--only", action="append", default=[], help="path prefix (repeatable)")
    args = parser.parse_args(argv)

    client = Client(args.url, args.token)
    dest = args.dest.expanduser()
    files = [f for f in client.files() if not args.only or f.path.startswith(tuple(args.only))]
    unique, twins = dedupe(files)
    total = sum(f.size for f in unique)
    print(
        f"{len(files)} files, {total / 1e9:.1f} GB to download "
        f"(+{len(twins)} identical copies made here) -> {dest}",
        flush=True,
    )
    done_bytes = 0
    failures: list[str] = []
    changed = 0
    started = time.monotonic()
    with ThreadPoolExecutor(max_workers=args.jobs) as pool:
        futures = {pool.submit(client.fetch, f, dest): f for f in unique}
        for future in as_completed(futures):
            remote = futures[future]
            try:
                outcome = future.result()
            except Exception as error:
                changed += isinstance(error, ChangedOnServer)
                failures.append(remote.path)
                print(f"FAILED {remote.path}: {error}", file=sys.stderr, flush=True)
                continue
            done_bytes += remote.size
            rate = done_bytes / max(time.monotonic() - started, 1e-3) / 1e6
            print(
                f"{outcome:10} {done_bytes / max(total, 1):6.1%} {rate:6.1f} MB/s {remote.path}",
                flush=True,
            )
    failed = set(failures)
    for twin, original in twins:
        if original.path in failed:
            failures.append(twin.path)
            continue
        try:
            print(f"{place_twin(twin, original, dest):10} {twin.path}", flush=True)
        except OSError as error:
            failures.append(twin.path)
            print(f"FAILED {twin.path}: {error}", file=sys.stderr, flush=True)
    if failures:
        print(f"{len(failures)} files failed; run the same command again to resume.")
        print(
            f"{changed} of them changed on the PC after serve-slim started. If files keep failing, "
            "restart serve-slim there (it re-indexes) and rerun with the new token."
        )
        return 1
    print("all files verified")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
