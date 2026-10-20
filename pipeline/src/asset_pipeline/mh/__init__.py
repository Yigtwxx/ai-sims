"""MetaHuman DNA to web glTF conversion.

Modules:

- `openriglogic`: locates and imports Epic's vendored `dna` and `riglogic` Python bindings
  (built by `pipeline/scripts/build_openriglogic.py`).
- `dna`: reads a DNA file into plain dataclasses of numpy arrays (DNA units and axes).
- `rig`: evaluates the real MetaHuman rig with RigLogic and deforms meshes with it.

Nothing here converts to glTF space; that happens in the writer, so DNA data stays
faithful to the file and can be checked against Unreal.
"""
