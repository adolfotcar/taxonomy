"""Shared lookups used by the preview and the tile export: colour groups,
signpost species and name → node resolution."""

import tomllib
from dataclasses import dataclass
from pathlib import Path

import duckdb
import numpy as np

SIGNPOSTS_FILE = Path(__file__).resolve().parents[2] / "signposts.toml"


@dataclass(frozen=True)
class Group:
    taxon: str  # scientific name in the tree
    label: str  # display name
    colour: tuple[int, int, int]


# Colour groups. Later entries are nested inside earlier ones and win.
# Index 0 is reserved for "no group".
GROUPS: tuple[Group, ...] = (
    Group("Bacteria", "Bacteria", (66, 133, 160)),
    Group("Archaea", "Archaea", (150, 110, 190)),
    Group("Eukaryota", "Eukaryotes", (140, 140, 140)),
    Group("Chloroplastida", "Plants", (70, 150, 70)),
    Group("Fungi", "Fungi", (190, 130, 50)),
    Group("Metazoa", "Animals", (200, 80, 80)),
    Group("Insecta", "Insects", (220, 150, 60)),
    Group("Chordata", "Chordates", (90, 110, 210)),
)
NO_GROUP_COLOUR = (110, 110, 110)


def load_signposts(path: Path = SIGNPOSTS_FILE) -> list[dict[str, str]]:
    with path.open("rb") as f:
        return tomllib.load(f)["signpost"]


def resolve_name(con: duckdb.DuckDBPyConnection, name: str) -> int | None:
    """Tree node id for a scientific name.

    Falls back to the largest tree node among the taxon's taxonomic descendants when
    the taxon itself is not a node in the tree (a "broken" taxon such as
    *Escherichia coli*, which is not monophyletic in the synthesis).
    """
    row = con.execute(
        """SELECT t.id FROM tree t JOIN layout l USING (id)
           WHERE t.name = ? ORDER BY l.tips DESC LIMIT 1""",
        [name],
    ).fetchone()
    if row:
        return row[0]
    row = con.execute(
        """
        WITH RECURSIVE sub AS (
            SELECT ott_id FROM taxon WHERE name = ?
            UNION ALL
            SELECT t.ott_id FROM taxon t JOIN sub ON t.parent_ott_id = sub.ott_id
        )
        SELECT n.id FROM sub JOIN node n USING (ott_id) JOIN layout l USING (id)
        ORDER BY l.tips DESC LIMIT 1
        """,
        [name],
    ).fetchone()
    return row[0] if row else None


def group_roots(con: duckdb.DuckDBPyConnection) -> list[int | None]:
    """Node id of each group's root (None if the group is missing from the tree)."""
    return [resolve_name(con, g.taxon) for g in GROUPS]


def group_index(con: duckdb.DuckDBPyConnection) -> np.ndarray:
    """Per node (indexed by id): 0 = no group, i = GROUPS[i - 1].

    A node is in a group when its slice lies inside the group root's slice and it is
    not closer to the centre (which excludes ancestors in single-child chains).
    """
    cols = con.execute("SELECT a0, a1, r FROM layout ORDER BY id").fetchnumpy()
    a0, a1, r = cols["a0"], cols["a1"], cols["r"]
    g = np.zeros(len(a0), dtype=np.int8)
    for i, root in enumerate(group_roots(con), start=1):
        if root is None:
            print(f"    group not found in tree: {GROUPS[i - 1].taxon}")
            continue
        inside = (a0 >= a0[root]) & (a1 <= a1[root]) & (r >= r[root])
        g[inside] = i
    return g
