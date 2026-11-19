import json

from taxonomy_pipeline import build_db, layout, tiles
from tests.test_build_db import TAXONOMY


def test_end_to_end_tiles(tmp_path):
    tree = build_db.tree_file(tmp_path)
    tax = build_db.taxonomy_file(tmp_path)
    tree.parent.mkdir(parents=True)
    tax.parent.mkdir(parents=True)
    tree.write_text("((ott3,ott4)mrcaott3ott4)ott2;")
    tax.write_text(TAXONOMY)
    build_db.build(tmp_path)
    layout.run(tmp_path, compression=1.0)

    out = tmp_path / "web"
    manifest = json.loads(tiles.export(tmp_path, out).read_text())

    assert manifest["version"] == "opentree16.1-c100f20"
    assert manifest["nodeCount"] == 4
    seen = {}
    for level, indexes in manifest["tiles"].items():
        for k in indexes:
            path = out / manifest["tilePath"].format(level=level, index=k)
            tile = json.loads(path.read_text())
            assert set(tile) == {"id", "a0", "span", "d", "pd", "pm", "ps", "tips", "g", "name"}
            for i, node in enumerate(tile["id"]):
                assert node not in seen
                seen[node] = {c: tile[c][i] for c in tile}
    assert sorted(seen) == [0, 1, 2, 3]
    assert seen[0]["name"] == "Homo" and seen[0]["pd"] == 1.0
    assert seen[1]["name"] is None  # unnamed clade
    assert seen[2]["name"] == "Homo sapiens" and seen[2]["d"] == 0.0
    assert seen[2]["pm"] == seen[1]["a0"] + seen[1]["span"] / 2
    assert seen[2]["ps"] == seen[1]["span"] and seen[0]["ps"] == 1.0
