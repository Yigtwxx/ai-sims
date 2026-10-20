"""Discovery probe: body constraints, texture graph outputs, subsystem API surface."""

# ruff: noqa: F821  (unreal, report are injected by mh_export.probe)
from mh_export import characters, ue

sub = ue.subsystem()
report["subsystem_methods"] = sorted(m for m in dir(sub) if not m.startswith("_"))
report["export_library"] = sorted(
    m for m in dir(unreal.MetaHumanCharacterExportBlueprintLibrary) if not m.startswith("_")
)
presets = characters.preset_paths()
report["presets"] = presets
bodies = {}
for name in ("Ada", "Bruce"):
    match = [p for p in presets if p.endswith(f".{name}")]
    if not match:
        continue
    copy = ue.duplicate(match[0], f"/Game/MHExport/Scratch/Probe_{name}.Probe_{name}")
    with ue.editing(copy):
        constraints = sub.get_body_constraints(copy)
        bodies[name] = [ue.dump_properties(c) for c in constraints]
        report.setdefault("character_properties", sorted(ue.editor_property_names(copy)))
        try:
            report[f"body_settings_{name}"] = ue.to_text(copy.get_editor_property("body_settings"))
        except Exception as exc:
            report[f"body_settings_{name}"] = repr(exc)
report["body_constraints"] = bodies
tgi = unreal.load_asset("/MetaHumanCharacter/TextureGraphs/TGI_SkinDCC.TGI_SkinDCC")
report["tgi_class"] = tgi.get_class().get_name() if tgi else None
if tgi:
    report["tgi_properties"] = ue.dump_properties(tgi)
    report["tgi_dir"] = sorted(m for m in dir(tgi) if not m.startswith("_"))
