import json
import os
from pathlib import Path

import pytest

from asset_pipeline.mh.groom_labels import LABELS_FILE, groom_labels, with_label

ARCHIVE = Path(os.environ.get("MH_ARCHIVE", Path.home() / "MetaHumanArchive"))
MANIFEST = ARCHIVE / "web" / "manifest.json"
SIZES = {"S": "Kısa", "M": "Orta boy", "L": "Uzun"}  # noqa: RUF001


def test_curated_labels_replace_the_converter_label() -> None:
    pixie = {"id": "groom.hair.Hair_S_Pixie", "slot": "hair", "label": "Short Pixie"}
    labelled = with_label(pixie)
    assert labelled["label"] == {"tr": "Kısa pixie", "en": "Pixie cut"}  # noqa: RUF001
    assert labelled["id"] == pixie["id"] and pixie["label"] == "Short Pixie"


def test_an_unlisted_style_keeps_its_label() -> None:
    other = {"id": "groom.hair.Hair_X_Unknown", "slot": "hair", "label": "Unknown"}
    assert with_label(other) == other


def test_a_label_without_both_languages_is_rejected(tmp_path: Path) -> None:
    path = tmp_path / "labels.json"
    path.write_text(json.dumps({"Hair_S_Pixie": {"en": "Pixie cut", "tr": ""}}), "utf-8")
    with pytest.raises(ValueError, match="Hair_S_Pixie"):
        groom_labels(path)


def test_turkish_sizes_follow_the_style_size_code() -> None:
    """A label that names a size names the one in the style id (`Hair_M_...` is `Orta boy`)."""
    for style, label in groom_labels().items():
        size = style.split("_")[1]
        named = [word for word in SIZES.values() if label["tr"].startswith(word)]
        assert named in ([], [SIZES[size]]), f"{style}: {label['tr']}"


@pytest.mark.skipif(not MANIFEST.is_file(), reason=f"no converted manifest at {MANIFEST}")
def test_every_manifest_groom_has_turkish_and_english_labels() -> None:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    labels = groom_labels(LABELS_FILE)
    styles = [str(groom["id"]).split(".", 2)[-1] for groom in manifest["grooms"]]
    assert styles, "the manifest lists no grooms"
    missing = [style for style in styles if style not in labels]
    assert not missing, f"{LABELS_FILE.name} lacks {missing}"
