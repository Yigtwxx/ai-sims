from pathlib import Path

from mh_export.udim import tile_files


def _touch(directory: Path, *names: str) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    for name in names:
        (directory / name).write_bytes(b"x")


def test_tile_files_lists_the_tiles_written_instead_of_the_requested_file(tmp_path):
    _touch(
        tmp_path,
        "T_Coat_BC.1002.png",
        "T_Coat_BC.1001.png",
        "T_Coat_BC.1011.png",
        "T_Coat_BC.1001.tga",  # another format
        "T_Coat_BC_Mask.1001.png",  # another texture sharing the prefix
        "T_Coat.1001.png",
    )
    tiles = tile_files(tmp_path / "T_Coat_BC.png")
    assert {tile: path.name for tile, path in tiles.items()} == {
        1001: "T_Coat_BC.1001.png",
        1002: "T_Coat_BC.1002.png",
        1011: "T_Coat_BC.1011.png",
    }
    assert list(tiles) == [1001, 1002, 1011]


def test_tile_files_is_empty_for_plain_textures_and_missing_folders(tmp_path):
    _touch(tmp_path, "T_Shirt_N.png", "T_Shirt_N.v2.png", "T_Shirt_N.0999.png")
    assert tile_files(tmp_path / "T_Shirt_N.png") == {}
    assert tile_files(tmp_path / "missing" / "T_Shirt_N.png") == {}
