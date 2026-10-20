"""Locate and import the vendored OpenRigLogic Python bindings (`dna` and `riglogic`).

The bindings are native extension modules built for one interpreter and platform by
`pipeline/scripts/build_openriglogic.py`. They live in
`pipeline/vendor/openriglogic/<platform_tag>/` (gitignored), next to the SWIG-generated
`dna.py` / `riglogic.py` proxies. `AI_SIMS_OPENRIGLOGIC_DIR` overrides the directory.

This module only uses the standard library at import time, so the build script can import
`platform_tag()` from it before the bindings exist.
"""

import importlib
import os
import platform
import sys
import sysconfig
from dataclasses import dataclass
from functools import cache
from pathlib import Path
from types import ModuleType

from asset_pipeline.config import PIPELINE_ROOT

VENDOR_ROOT = PIPELINE_ROOT / "vendor" / "openriglogic"
ENV_DIR = "AI_SIMS_OPENRIGLOGIC_DIR"
BUILD_COMMAND = "cd pipeline && uv run --no-sync python scripts/build_openriglogic.py"
BUILD_INFO_FILE = "BUILD_INFO.json"
MODULE_NAMES = ("dna", "riglogic")


class OpenRigLogicUnavailableError(ImportError):
    """The vendored bindings are missing or cannot be imported for this interpreter."""


@dataclass(frozen=True)
class OpenRigLogic:
    """The imported binding modules and where they were loaded from."""

    dna: ModuleType
    riglogic: ModuleType
    directory: Path


def platform_tag() -> str:
    """Tag naming the vendor directory: `<os>_<arch>-<python tag>`.

    Examples: `win_amd64-cp313`, `macosx_arm64-cp313`, `linux_x86_64-cp313`. Free-threaded
    interpreters get a `t` suffix (`cp313t`) because their extension ABI differs.
    """
    machine = platform.machine().lower()
    if sys.platform == "win32":
        # sysconfig reports the interpreter's own architecture (win-amd64, win-arm64, win32),
        # which may differ from the host's under emulation.
        arch = {"win-amd64": "amd64", "win-arm64": "arm64", "win32": "x86"}.get(
            sysconfig.get_platform(), machine
        )
        os_arch = f"win_{arch}"
    elif sys.platform == "darwin":
        os_arch = f"macosx_{machine}"
    else:
        os_arch = f"{sys.platform}_{machine}"
    implementation = "cp" if sys.implementation.name == "cpython" else sys.implementation.name
    version = f"{sys.version_info.major}{sys.version_info.minor}"
    free_threaded = "t" if sysconfig.get_config_var("Py_GIL_DISABLED") else ""
    return f"{os_arch}-{implementation}{version}{free_threaded}"


def vendor_dir() -> Path:
    """Directory holding the bindings for the running interpreter."""
    override = os.environ.get(ENV_DIR)
    if override:
        return Path(override).expanduser().resolve()
    return VENDOR_ROOT / platform_tag()


def _missing_message(directory: Path, detail: str) -> str:
    return (
        f"OpenRigLogic bindings are not available for {platform_tag()} ({detail}).\n"
        f"  looked in: {directory}\n"
        f"  build them with: {BUILD_COMMAND}\n"
        f"  (or point {ENV_DIR} at a directory containing dna.py and riglogic.py)"
    )


def _check_origin(module: ModuleType, directory: Path) -> None:
    origin = getattr(module, "__file__", None)
    if origin is None or Path(origin).resolve().parent != directory.resolve():
        raise OpenRigLogicUnavailableError(
            f"Module {module.__name__!r} was imported from {origin}, not from {directory}. "
            "Another module with the same name shadows the vendored binding."
        )


@cache
def load_openriglogic() -> OpenRigLogic:
    """Import `dna` and `riglogic` from the vendor directory (once per process).

    Raises:
        OpenRigLogicUnavailableError: with build instructions when the directory or a module
            is missing, or when the native extension fails to load.
    """
    directory = vendor_dir()
    for name in MODULE_NAMES:
        if not (directory / f"{name}.py").is_file():
            raise OpenRigLogicUnavailableError(_missing_message(directory, f"no {name}.py"))

    if sys.platform == "win32":
        # Native modules may depend on DLLs next to them; Python does not search sys.path
        # for DLL dependencies since 3.8.
        os.add_dll_directory(str(directory))
    if str(directory) not in sys.path:
        sys.path.insert(0, str(directory))

    try:
        dna = importlib.import_module("dna")
        riglogic = importlib.import_module("riglogic")
    except ImportError as error:
        hint = ""
        if sys.platform == "win32" and "DLL load failed" in str(error):
            hint = "; the Microsoft Visual C++ 2015-2022 x64 runtime may be missing"
        raise OpenRigLogicUnavailableError(
            _missing_message(directory, f"import failed: {error}{hint}")
        ) from error

    for module in (dna, riglogic):
        _check_origin(module, directory)
    return OpenRigLogic(dna=dna, riglogic=riglogic, directory=directory)


def is_available() -> bool:
    """True when the bindings import cleanly (used by tests to skip)."""
    try:
        load_openriglogic()
    except OpenRigLogicUnavailableError:
        return False
    return True
