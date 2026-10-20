"""Run a throwaway discovery script inside the editor and keep what it printed.

Used to inspect Python-exposed APIs (property names, enum members) before a
real job relies on them. Args: script (path to a .py file). The script gets
`unreal`, `archive` and a `report` dict in its globals; the dict is returned.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import unreal

from mh_export.archive import Archive, write_json


def run(archive: Archive, args: dict[str, Any]) -> dict[str, Any]:
    script = Path(args["script"])
    report: dict[str, Any] = {}
    scope = {"unreal": unreal, "archive": archive, "report": report, "__name__": "__probe__"}
    exec(compile(script.read_text(encoding="utf-8"), str(script), "exec"), scope)
    write_json(archive.logs / f"probe-{script.stem}.json", report)
    return report
