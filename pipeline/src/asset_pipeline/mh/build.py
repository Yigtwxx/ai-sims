"""Incremental batch conversion of the MetaHuman archive, and the web manifest.

`Builder` runs one converter per asset (head, skin, iris, body, animation, lighting rig,
groom). Each run is keyed by its output folder and fingerprinted from the source units'
`done.json` plus the converter version (`stamps.py`); an asset whose fingerprint is
unchanged and whose outputs exist is skipped, so the batch can be re-run as new presets
land. The manifest is assembled from the build records of every asset that exists.
Assets pruned after curation (`raw/pruned.json`, see prune.py) are never rebuilt nor
listed.
"""

import json
import time
from collections.abc import Callable, Iterable, Iterator, Sequence
from dataclasses import dataclass, field
from functools import cached_property
from pathlib import Path
from typing import Any, Literal

from asset_pipeline.mh.anim import (
    BodyTarget,
    Clip,
    ClipError,
    ClipInfo,
    FaceFitter,
    convert_body_clip,
    convert_face_clip,
    describe,
    leg_length,
    list_clip_units,
)
from asset_pipeline.mh.compat import curated_compat
from asset_pipeline.mh.convert import (
    CharacterSource,
    ConversionError,
    bake_head,
    body_driven_joints,
    body_fingerprint,
    body_live_rule,
    convert_body,
    convert_head,
    convert_iris,
    convert_skin,
    head_fingerprint,
    head_live_rule,
    iris_fingerprint,
    list_characters,
    preset_gender,
    skin_fingerprint,
)
from asset_pipeline.mh.dna import Mesh, read_dna
from asset_pipeline.mh.groom_labels import with_label
from asset_pipeline.mh.grooms import (
    GROOMS_VERSION,
    GroomError,
    GroomHead,
    GroomUnit,
    ReferenceHead,
    convert_groom,
    list_groom_units,
)
from asset_pipeline.mh.grooms import HEADS as GROOM_HEADS
from asset_pipeline.mh.ktx import KtxEncodeError, KtxUnavailableError
from asset_pipeline.mh.lighting import convert_level, has_lights, list_levels, manifest_entry
from asset_pipeline.mh.manifest import assemble, write_manifest
from asset_pipeline.mh.outfits import (
    HUG_VERSION,
    OUTFITS_VERSION,
    BodyFit,
    OutfitError,
    OutfitUnit,
    base_body_path,
    convert_outfit,
    hug_for,
    list_outfit_units,
    manifest_entries,
)
from asset_pipeline.mh.rig import MetaHumanRig
from asset_pipeline.mh.stamps import Stamps, fingerprint
from asset_pipeline.mh.strand_paint import PAINTS, STRAND_PAINT_VERSION
from asset_pipeline.mh.textures import TextureError, write_json
from asset_pipeline.mh.visemes import VISEME_RECIPES

Status = Literal["built", "skipped", "failed"]
EXPECTED_ERRORS = (
    ConversionError,
    TextureError,
    KtxEncodeError,
    KtxUnavailableError,
    ClipError,
    GroomError,
    OutfitError,
    OSError,
    ValueError,
)
FACE_REFERENCE = "Ada"  # head whose ARKit morphs face clips are fitted on
PRUNED_FILE = Path("raw") / "pruned.json"  # ids curated out and deleted (prune.py)
CLIP_ROLES = frozenset({"idle", "talk", "listen"})  # roles retarget-fbx.mjs writes per clip


def read_pruned(archive: Path) -> frozenset[str]:
    path = archive / PRUNED_FILE
    if not path.is_file():
        return frozenset()
    data = json.loads(path.read_text(encoding="utf-8"))
    ids = data.get("ids", []) if isinstance(data, dict) else []
    return frozenset(str(i) for i in ids)


@dataclass(frozen=True)
class Outcome:
    key: str
    status: Status
    seconds: float
    detail: str = ""


@dataclass
class Builder:
    archive: Path
    web_root: Path | None = None
    force: bool = False
    compress: bool = True
    log: Callable[[str], None] = print
    outcomes: list[Outcome] = field(default_factory=list)

    @property
    def web(self) -> Path:
        return self.web_root or self.archive / "web"

    @property
    def extras(self) -> Path:
        """Files that come beside the Fab packages (strand files, hand-made cards)."""
        return self.archive / "fab_extras"

    @property
    def stamps(self) -> Stamps:
        # Stamps sit beside web/ (archive/build/stamps for the real archive).
        return Stamps(self.web.parent)

    @cached_property
    def pruned(self) -> frozenset[str]:
        return read_pruned(self.archive)

    def _is_pruned(self, key: str, asset_id: str) -> bool:
        if asset_id not in self.pruned:
            return False
        self.log(f"skip    {key}: pruned")
        return True

    @property
    def mapping_path(self) -> Path:
        return self.archive / "raw" / "arkit" / "arkit_mapping.json"

    def run(
        self,
        key: str,
        print_: str,
        build: Callable[[], tuple[Iterable[Path], dict[str, Any], str]],
    ) -> Outcome:
        """Build `key` unless its stamp is current; `build` returns (outputs, info, detail)."""
        if not self.force and self.stamps.is_current(key, print_):
            outcome = Outcome(key, "skipped", 0.0, "up to date")
        else:
            started = time.perf_counter()
            try:
                outputs, info, detail = build()
            except EXPECTED_ERRORS as error:
                outcome = Outcome(key, "failed", time.perf_counter() - started, str(error))
            else:
                self.stamps.record(key, print_, outputs, info)
                outcome = Outcome(key, "built", time.perf_counter() - started, detail)
        self.outcomes.append(outcome)
        self.log(f"{outcome.status:7s} {key:40s} {outcome.seconds:7.1f}s  {outcome.detail}")
        return outcome

    # ------------------------------------------------------------------------ assets

    def characters(self, requested: Sequence[str]) -> list[str]:
        available = list_characters(self.archive)
        if not requested or "all" in requested:
            return available
        return [name for name in requested if name in available or self._warn_missing(name)]

    def _warn_missing(self, name: str) -> bool:
        self.log(f"skip    characters/{name}: no finished export (done.json)")
        return False

    def head(self, name: str) -> Outcome | None:
        if self._is_pruned(f"faces/{name}", f"face.{name}"):
            return None

        def build() -> tuple[Iterable[Path], dict[str, Any], str]:
            result = convert_head(
                name, self.archive, web_root=self.web_root, compress=self.compress
            )
            stats = result.stats
            detail = (
                f"{stats.size / 1e6:.1f} MB (raw {stats.raw_size / 1e6:.1f} MB), "
                f"{len(stats.targets)} targets, gender {result.face['gender']}"
            )
            return result.outputs, result.info, detail

        try:
            print_ = head_fingerprint(self.archive, name, self.mapping_path, self.compress)
        except ConversionError as error:
            return self._fail(f"faces/{name}", error)
        return self.run(f"faces/{name}", print_, build)

    def skin(self, name: str) -> Outcome | None:
        if self._is_pruned(f"skins/{name}", f"skin.{name}"):
            return None

        def build() -> tuple[Iterable[Path], dict[str, Any], str]:
            entry = convert_skin(name, self.archive, web_root=self.web_root)
            outputs = [self.web / path for path in _entry_files(entry)]
            stats = entry.get("stats", {})
            total = sum(stats.get("bytes", {}).values())
            detail = f"tone {entry['tone']:.2f} {entry['swatch']}, {total / 1e6:.1f} MB"
            if "makeupAlbedo" in entry:
                detail += ", makeup"
            return outputs, {"skin": entry}, detail

        try:
            print_ = skin_fingerprint(self.archive, name)
        except ConversionError as error:
            return self._fail(f"skins/{name}", error)
        return self.run(f"skins/{name}", print_, build)

    def iris(self, name: str) -> Outcome | None:
        if self._is_pruned(f"irises/{name}", f"iris.{name}"):
            return None

        def build() -> tuple[Iterable[Path], dict[str, Any], str]:
            entry = convert_iris(name, self.archive, web_root=self.web_root)
            outputs = [self.web / entry["color"], self.web / entry["normal"]]
            return outputs, {"iris": entry}, entry["swatch"]

        try:
            print_ = iris_fingerprint(self.archive, name)
        except ConversionError as error:
            return self._fail(f"irises/{name}", error)
        return self.run(f"irises/{name}", print_, build)

    def body(self, gender: str) -> Outcome:
        def build() -> tuple[Iterable[Path], dict[str, Any], str]:
            stats, entry = convert_body(
                gender, self.archive, web_root=self.web_root, compress=self.compress
            )
            detail = f"{stats.size / 1e6:.1f} MB (raw {stats.raw_size / 1e6:.1f} MB)"
            return [stats.path], {"body": entry}, detail

        unit = self.archive / "raw" / "bodies" / gender
        if not (unit / "done.json").is_file():
            return self._fail(f"bodies/{gender}", ConversionError(f"{unit} has no done.json"))
        return self.run(
            f"bodies/{gender}", body_fingerprint(self.archive, gender, self.compress), build
        )

    # ------------------------------------------------------------------------ animations

    def _body_target(self) -> BodyTarget:
        lengths = {}
        dnas = {}
        for gender in ("female", "male"):
            path = self.archive / "raw" / "bodies" / gender / "neutral" / f"Body_{gender}_Body.dna"
            if path.is_file():
                dnas[gender] = read_dna(path, geometry=False)
                joints = dnas[gender].joints
                lengths[gender] = leg_length(joints.names, joints.translations) * 0.01
        gender = "female" if "female" in dnas else next(iter(dnas), None)
        if gender is None:
            raise ConversionError("no body basis DNA to retarget body clips onto")
        dna = dnas[gender]
        live = body_live_rule(dna)
        return BodyTarget(
            dna=dna,
            live=frozenset(n for n in dna.joints.names if live(n)),
            leg_lengths=lengths,
            gender=gender,
            rig=MetaHumanRig(dna),
        )

    def _face_reference(self) -> str:
        names = list_characters(self.archive)
        if FACE_REFERENCE in names:
            return FACE_REFERENCE
        if not names:
            raise ConversionError("no converted preset to fit face clips on")
        return names[0]

    def _face_fitter(self, reference: str) -> FaceFitter:
        source = CharacterSource.find(self.archive, reference)
        dna = read_dna(source.head_dna, lods=[0])
        rig, targets, _ = bake_head(dna, self.mapping_path, VISEME_RECIPES)
        return FaceFitter.from_targets(rig, targets, reference)

    def animations(self, only: Sequence[str] = ()) -> None:
        clips_root = self.archive / "raw" / "animations"
        state: dict[str, Any] = {}
        reference = self._face_reference()
        reference_done = CharacterSource.find(self.archive, reference).done
        for unit in list_clip_units(self.archive):
            try:
                clip = Clip.load(unit)
            except (OSError, ValueError, KeyError) as error:
                self._fail(f"animations/{unit.name}", ClipError(str(error)))
                continue
            info = describe(unit.relative_to(clips_root), clip.kind)
            if only and info.id not in only:
                continue
            if self._is_pruned(f"animations/{info.file_stem}", info.id):
                continue
            suffix = ".glb" if clip.kind == "body" else ".json"
            output = self.web / "animations" / f"{info.file_stem}{suffix}"
            entry = {
                "id": info.id,
                "kind": clip.kind,
                "file": output.relative_to(self.web).as_posix(),
                "loop": info.loop,
                "tags": list(info.tags),
            }
            if clip.kind == "body":
                print_ = fingerprint(
                    "body-clip-v3",  # v2: twists from the body rig; v3: idle tags
                    unit / "done.json",
                    self.archive / "raw" / "bodies" / "female" / "done.json",
                    self.compress,
                )
            else:
                print_ = fingerprint(
                    "face-clip-v1", unit / "done.json", reference_done, self.mapping_path
                )
            self.run(
                f"animations/{info.file_stem}",
                print_,
                self._clip_builder(clip, info, output, entry, reference, state),
            )

    def _clip_builder(
        self,
        clip: Clip,
        info: ClipInfo,
        output: Path,
        entry: dict[str, Any],
        reference: str,
        state: dict[str, Any],
    ) -> Callable[[], tuple[Iterable[Path], dict[str, Any], str]]:
        def build() -> tuple[Iterable[Path], dict[str, Any], str]:
            if clip.kind == "body":
                if "body" not in state:
                    state["body"] = self._body_target()
                stats = convert_body_clip(clip, state["body"], info, output, compress=self.compress)
                detail = (
                    f"{stats['bytes'] / 1e3:.0f} kB, {stats['tracks']} rotation tracks, "
                    f"lowest foot {stats['lowest_foot_y_m']:.3f} m"
                )
            else:
                if "face" not in state:
                    state["face"] = self._face_fitter(reference)
                stats = convert_face_clip(clip, state["face"], info, output)
                detail = (
                    f"{stats['bytes'] / 1e3:.0f} kB, {stats['morphs']} morphs, residual "
                    f"{stats['residual_rms_mm']:.2f} mm rms (motion "
                    f"{stats['motion_rms_mm']:.2f} mm)"
                )
            return [output], {"animation": entry, "stats": stats}, detail

        return build

    # ------------------------------------------------------------------------ lighting

    def lighting(self) -> None:
        for level in list_levels(self.archive):
            rig = convert_level(level)
            if not has_lights(rig):
                self.log(f"skip    lighting/{level.name}: no lights")
                continue
            output = self.web / "lighting" / f"{rig['id'].removeprefix('light.')}.json"
            print_ = fingerprint("lighting-v1", level / "done.json", level / "lighting.json")
            self.run(f"lighting/{level.name}", print_, self._lighting_builder(rig, output))

    def _lighting_builder(
        self, rig: dict[str, Any], output: Path
    ) -> Callable[[], tuple[Iterable[Path], dict[str, Any], str]]:
        def build() -> tuple[Iterable[Path], dict[str, Any], str]:
            write_json(output, rig)
            entry = manifest_entry(rig, output.relative_to(self.web).as_posix())
            return [output], {"lighting": entry}, f"{len(rig['lights'])} lights"

        return build

    # ------------------------------------------------------------------------ grooms

    def _groom_setup(self, reference: str) -> tuple[dict[str, GroomHead], ReferenceHead, Mesh]:
        source = CharacterSource.find(self.archive, reference)
        dna = read_dna(source.head_dna, lods=[0])
        _, targets, _ = bake_head(dna, self.mapping_path, VISEME_RECIPES)
        live = head_live_rule(body_driven_joints(read_dna(source.body_dna, geometry=False)))
        head = ReferenceHead.build(
            reference, dna, targets, {name: live(name) for name in dna.joints.names}
        )
        mesh = next(m for m in dna.meshes_for_lod(0) if m.name.startswith("head_"))
        folder = self.archive / "raw" / "grooms" / "groom_head"
        heads = {
            name: GroomHead.load(folder / f"{name}.glb", mesh)
            for name in GROOM_HEADS
            if (folder / f"{name}.glb").is_file()
        }
        if not heads:
            raise ConversionError(f"no groom head GLBs in {folder}")
        return heads, head, mesh

    def grooms(self, only: Sequence[str] = ()) -> None:
        units = list_groom_units(self.archive)
        if not units:
            return
        reference = self._face_reference()
        reference_done = CharacterSource.find(self.archive, reference).done
        head_done = self.archive / "raw" / "grooms" / "groom_head" / "done.json"
        state: dict[str, Any] = {}
        for unit in units:
            try:
                groom = GroomUnit.load(unit)
            except (OSError, ValueError, KeyError) as error:
                self._fail(f"grooms/{unit.name}", GroomError(str(error)))
                continue
            key = f"grooms/{groom.slot}/{groom.style}"
            if only and groom.style not in only and key not in only:
                continue
            if self._is_pruned(key, f"groom.{groom.slot}.{groom.style}"):
                continue
            paint = PAINTS.get(groom.style)
            strands = [STRAND_PAINT_VERSION, self.extras / paint.extras] if paint else []
            print_ = fingerprint(
                GROOMS_VERSION,
                unit / "done.json",
                head_done,
                reference_done,
                self.mapping_path,
                *strands,
            )
            self.run(key, print_, self._groom_builder(groom, reference, state))

    def _groom_builder(
        self, groom: GroomUnit, reference: str, state: dict[str, Any]
    ) -> Callable[[], tuple[Iterable[Path], dict[str, Any], str]]:
        def build() -> tuple[Iterable[Path], dict[str, Any], str]:
            if "setup" not in state:
                state["setup"] = self._groom_setup(reference)
            heads, head, mesh = state["setup"]
            entry, outputs, stats = convert_groom(
                groom, heads, head, self.web, dna_head=mesh, extras_root=self.extras
            )
            if stats.get("painted"):
                detail = f"painted on the skin ({', '.join(stats['textures'])})"
                return outputs, {"groom": entry, "stats": stats}, detail
            lods = ", ".join(f"{lod['source']} {lod['vertices']}v" for lod in stats["lods"])
            detail = (
                f"{stats['bytes'] / 1e6:.1f} MB glb ({lods}), on {stats['head']}, roots "
                f"{stats['root_distance_mm']['p95']:.1f} mm p95"
            )
            return outputs, {"groom": entry, "stats": stats}, detail

        return build

    # ------------------------------------------------------------------------ outfits

    def outfits(self, only: Sequence[str] = ()) -> None:
        """`outfits/<name>/<gender>.glb` for every finished outfit unit, refitted onto the
        converted body of that gender (build the bodies first)."""
        bodies: dict[str, BodyFit] = {}
        for unit in list_outfit_units(self.archive):
            key = f"outfits/{unit.name}/{unit.gender}"
            if only and unit.name not in only and key not in only:
                continue
            if self._is_pruned(key, f"outfit.{unit.name}"):
                continue
            body_glb = self.web / "bodies" / unit.gender / "body.glb"
            base = base_body_path(self.archive, unit.gender)
            if not body_glb.is_file() or not base.is_file():
                self._fail(key, OutfitError(f"needs {body_glb.name} and {base.name} first"))
                continue
            # Only outfits with a hug carry it, so adding one rebuilds that outfit alone.
            hug = hug_for(unit.name, unit.gender)
            print_ = fingerprint(
                OUTFITS_VERSION,
                unit.done,
                base.parent / "done.json",
                body_glb,
                self.compress,
                *([{"hug": hug, "version": HUG_VERSION}] if hug else []),
            )
            self.run(key, print_, self._outfit_builder(unit, body_glb, base, bodies))

    def _outfit_builder(
        self, unit: OutfitUnit, body_glb: Path, base: Path, bodies: dict[str, BodyFit]
    ) -> Callable[[], tuple[Iterable[Path], dict[str, Any], str]]:
        def build() -> tuple[Iterable[Path], dict[str, Any], str]:
            if unit.gender not in bodies:
                bodies[unit.gender] = BodyFit.load(body_glb, base, unit.gender)
            result = convert_outfit(
                unit, bodies[unit.gender], self.web, archive=self.archive, log=self.log
            )
            stats = result.stats
            texture_bytes = sum(stats["textures"].values())
            detail = (
                f"{stats['bytes'] / 1e6:.1f} MB glb + {texture_bytes / 1e6:.1f} MB maps, "
                f"{stats['vertices']}v, {stats['caps']} caps, hides {stats['hidden']} body "
                f"vertices, {result.record['category']}"
            )
            info = {"outfit": result.record, "stats": stats}
            return result.outputs, info, detail

        return build

    def _fail(self, key: str, error: Exception) -> Outcome:
        outcome = Outcome(key, "failed", 0.0, str(error))
        self.outcomes.append(outcome)
        self.log(f"{outcome.status:7s} {key:40s} {0.0:7.1f}s  {outcome.detail}")
        return outcome

    # ------------------------------------------------------------------------ manifest

    def records(self, prefix: str) -> list[dict[str, Any]]:
        """Build infos of every current, unpruned asset under `prefix` (e.g. `skins`)."""
        root = self.stamps.root / prefix
        infos = []
        if not root.is_dir():
            return infos
        for stamp in sorted(root.rglob("*.json")):
            key = stamp.relative_to(self.stamps.root).with_suffix("").as_posix()
            data = self.stamps.read(key)
            if data and all((self.stamps.archive / o).is_file() for o in data.get("outputs", [])):
                info = data.get("info", {})
                if not self.pruned & set(_ids(info)):
                    infos.append(info)
        return infos

    def manifest(self) -> Path:
        heads = self.records("faces")
        manifest = assemble(
            faces=[
                with_thumbnail(info["face"], "head", self.web) for info in heads if "face" in info
            ],
            skins=[
                with_gender(info["skin"], self.archive)
                for info in self.records("skins")
                if "skin" in info
            ],
            irises=[info["iris"] for info in self.records("irises") if "iris" in info],
            bodies=[info["body"] for info in self.records("bodies") if "body" in info],
            animations=[
                *(info["animation"] for info in self.records("animations") if "animation" in info),
                *(a for a in fab_animations(self.web) if a["id"] not in self.pruned),
            ],
            lighting=[info["lighting"] for info in self.records("lighting") if "lighting" in info],
            grooms=[
                with_label(
                    with_compat(
                        with_thumbnail(
                            info["groom"], "glb" if "glb" in info["groom"] else "painted", self.web
                        )
                    )
                )
                for info in self.records("grooms")
                if "groom" in info
            ],
            outfits=manifest_entries(
                [info["outfit"] for info in self.records("outfits") if "outfit" in info], self.web
            ),
            face_maps_from={
                str(info["face"]["id"]).removeprefix("face."): info.get("maps_from")
                for info in heads
                if "face" in info
            },
            face_tones={
                str(info["face"]["id"]).removeprefix("face."): info.get("tone_estimate")
                for info in heads
                if "face" in info
            },
        )
        path = self.web / "manifest.json"
        write_manifest(manifest, path, self.web)
        counts = ", ".join(f"{k} {len(v)}" for k, v in manifest.items() if isinstance(v, list))
        self.log(f"wrote   {path}  ({counts})")
        return path


def with_compat(groom: dict[str, Any]) -> dict[str, Any]:
    """The groom entry offered to the gender gender_compat.json gives its style, if any
    (`groom.hair.Hair_S_Pixie` -> `Hair_S_Pixie`); read at manifest time, so a changed list
    needs no reconversion."""
    compat = curated_compat("grooms", str(groom["id"]).split(".", 2)[-1])
    return {**groom, "compat": compat} if compat else groom


def with_gender(skin: dict[str, Any], archive: Path) -> dict[str, Any]:
    """The skin entry with its preset's gender, read at manifest time (no reconversion).
    A preset's maps carry its body's stubble shadow and strap mask, so the creator offers a
    skin on that body only."""
    name = str(skin["id"]).split(".", 1)[-1]
    try:
        source = CharacterSource.find(archive, name)
    except ConversionError:
        return skin
    gender, _ = preset_gender(archive, name, source.body_dna)
    return {**skin, "gender": gender} if gender else skin


def with_thumbnail(entry: dict[str, Any], file_key: str, web: Path) -> dict[str, Any]:
    """The entry with `thumbnail` set exactly when `<its folder>/thumbnail.webp` exists
    (the web app's thumbnail bench writes them beside the asset)."""
    out = dict(entry)
    folder = Path(str(out.get(file_key, ""))).parent
    thumbnail = web / folder / "thumbnail.webp"
    if out.get(file_key) and thumbnail.is_file():
        out["thumbnail"] = (folder / "thumbnail.webp").as_posix()
    else:
        out.pop("thumbnail", None)
    return out


def fab_animations(web: Path) -> list[dict[str, Any]]:
    """Body clips retargeted by the web app (`animations/fab/<set>/clips.json`, written by
    web/scripts/retarget-fbx.mjs): one entry per clip, tagged first with its role (`idle`,
    `talk` or `listen`; no role means idle, any other role skips the clip), then `standing` /
    `calm` as the clip list says. One file serves both bodies (identical rest rotations)."""
    entries = []
    for listing in sorted((web / "animations" / "fab").glob("*/clips.json")):
        try:
            clips = json.loads(listing.read_text(encoding="utf-8")).get("clips", [])
        except (OSError, json.JSONDecodeError, AttributeError):
            continue
        for clip in clips:
            file = listing.parent / str(clip.get("file", ""))
            if not clip.get("file") or not file.is_file():
                continue
            role = clip.get("role", "idle")
            if not isinstance(role, str) or role not in CLIP_ROLES:
                continue
            tags = [role]
            if clip.get("standing"):
                tags.append("standing")
            if clip.get("calm"):
                tags.append("calm")
            entries.append(
                {
                    "id": f"anim.fab.{listing.parent.name}.{file.stem}",
                    "kind": "body",
                    "file": file.relative_to(web).as_posix(),
                    "loop": True,
                    "tags": tags,
                }
            )
    return entries


def _ids(info: dict[str, Any]) -> list[str]:
    """Catalogue ids a build info lists (`{"face": {"id": ...}, ...}`)."""
    return [str(v["id"]) for v in info.values() if isinstance(v, dict) and "id" in v]


def _entry_files(entry: dict[str, Any]) -> list[str]:
    """Web files a skin entry names, nested maps (the underwear's) included. Only paths
    count: strings without a slash (a hex colour) are not files."""

    def walk(value: object) -> Iterator[str]:
        if isinstance(value, str):
            if "/" in value:
                yield value
        elif isinstance(value, dict):
            for item in value.values():
                yield from walk(item)
        elif isinstance(value, list):
            for item in value:
                yield from walk(item)

    return list(walk([entry["face"], entry["body"], entry.get("makeupAlbedo")]))
