import duckdb

from taxonomy_pipeline import build_db

TAXONOMY = """\
uid\t|\tparent_uid\t|\tname\t|\trank\t|\tsourceinfo\t|\tuniqname\t|\tflags\t|\t
1\t|\t\t|\tlife\t|\tno rank\t|\tncbi:1\t|\t\t|\t\t|\t
2\t|\t1\t|\tHomo\t|\tgenus\t|\tncbi:9605\t|\t\t|\t\t|\t
3\t|\t2\t|\tHomo sapiens\t|\tspecies\t|\tncbi:9606\t|\t\t|\textinct,sibling_higher\t|\t
4\t|\t2\t|\tHomo erectus\t|\tspecies\t|\t\t|\t\t|\textinct\t|\t
"""


def test_build_creates_joined_tree(tmp_path):
    tree = build_db.tree_file(tmp_path)
    tax = build_db.taxonomy_file(tmp_path)
    tree.parent.mkdir(parents=True)
    tax.parent.mkdir(parents=True)
    tree.write_text("((ott3,ott4)mrcaott3ott4)ott2;")
    tax.write_text(TAXONOMY)

    path = build_db.build(tmp_path)

    with duckdb.connect(path, read_only=True) as con:
        rows = con.execute(
            "SELECT id, parent_id, depth, ott_id, name, rank, flags FROM tree ORDER BY id"
        ).fetchall()
    assert rows == [
        (0, None, 0, 2, "Homo", "genus", []),
        (1, 0, 1, None, None, None, None),
        (2, 1, 2, 3, "Homo sapiens", "species", ["extinct", "sibling_higher"]),
        (3, 1, 2, 4, "Homo erectus", "species", ["extinct"]),
    ]
