"""Probe: masculine/feminine body value and fixed body type of every preset (and Fab characters)."""

# ruff: noqa: F821  (unreal, report are injected by mh_export.probe)
from mh_export import characters, ue
from mh_export.archive import write_json

genders = {}
for path in characters.preset_paths() + characters.fab_character_paths():
    name = path.rsplit(".", 1)[-1]
    copy = ue.duplicate(path, f"/Game/MHExport/Scratch/Gender_{name}.Gender_{name}")
    with ue.editing(copy):
        values = {
            str(c.name): float(c.target_measurement)
            for c in ue.subsystem().get_body_constraints(copy)
        }
    axis = values.get("Masculine/Feminine", 0.0)
    genders[name] = {
        "source": path,
        "masculine_feminine": axis,
        "gender": "female" if axis >= 0 else "male",
        "height_cm": values.get("Height"),
        "measurements": values,
    }
write_json(archive.raw / "characters_genders.json", genders)
report["genders"] = {k: v["gender"] for k, v in genders.items()}
