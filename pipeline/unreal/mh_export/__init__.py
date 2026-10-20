"""One-time MetaHuman library export, run inside Unreal Editor's embedded Python.

Modules that touch `unreal` import it lazily so the pure helpers (archive layout,
resume markers, progress logs) stay testable with plain pytest. Everything here
must stay compatible with Unreal's Python 3.11.
"""
