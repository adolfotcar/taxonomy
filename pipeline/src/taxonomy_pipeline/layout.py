"""Radial layout of the tree.

Every node gets an angular slice ``[a0, a1)`` (in turns, 0..1) and a radius ``r``
(0 = centre/origin of life, 1 = rim where all tips sit).

Slices: a node's slice is split among its children in proportion to
``tips ** compression``. ``compression = 1`` is strictly proportional to species
count; smaller values give small clades (mammals, birds…) more room.

Radius: ``r = depth / (depth + height)``, i.e. how far along its own longest
root-to-tip path a node is. Tips (height 0) land on the rim, the root at the
centre, and a parent is always strictly inside its children.

Relies on ``node.id`` being preorder: every child has a larger id than its parent.
"""

import time
from dataclasses import dataclass
from pathlib import Path

import duckdb
import numpy as np
import polars as pl

from .build_db import db_path

DEFAULT_COMPRESSION = 0.75


@dataclass
class Layout:
    a0: np.ndarray  # float64, slice start (turns)
    a1: np.ndarray  # float64, slice end (turns)
    r: np.ndarray  # float64, radius 0..1
    tips: np.ndarray  # int32, number of tips in subtree
    height: np.ndarray  # int16, longest path to a tip


def compute(
    parent: list[int], depth: list[int], compression: float = DEFAULT_COMPRESSION
) -> Layout:
    """``parent[i]`` is the parent of node ``i`` (-1 for the root, which must be 0)."""
    n = len(parent)
    if n == 0 or parent[0] != -1:
        raise ValueError("node 0 must be the root")

    # Bottom-up: tip counts and heights (children always have larger ids).
    tips = [0] * n
    height = [0] * n
    for i in range(n - 1, 0, -1):
        if tips[i] == 0:
            tips[i] = 1  # no children seen → tip
        p = parent[i]
        tips[p] += tips[i]
        height[p] = max(height[p], height[i] + 1)
    if tips[0] == 0:
        tips[0] = 1

    # Sum of child weights per parent.
    weight = [t**compression for t in tips]
    child_weight = [0.0] * n
    for i in range(1, n):
        child_weight[parent[i]] += weight[i]

    # Top-down: hand out slices in preorder (siblings appear in tree order).
    a0 = [0.0] * n
    a1 = [0.0] * n
    a1[0] = 1.0
    cursor = [0.0] * n  # next free angle inside each parent's slice
    for i in range(1, n):
        p = parent[i]
        span = (a1[p] - a0[p]) * weight[i] / child_weight[p]
        start = a0[p] + cursor[p]
        a0[i] = start
        a1[i] = start + span
        cursor[p] += span

    r = [d / (d + h) if d + h else 0.0 for d, h in zip(depth, height, strict=True)]

    return Layout(
        a0=np.array(a0, dtype=np.float64),
        a1=np.array(a1, dtype=np.float64),
        r=np.array(r, dtype=np.float64),
        tips=np.array(tips, dtype=np.int32),
        height=np.array(height, dtype=np.int16),
    )


def run(data_dir: Path, compression: float = DEFAULT_COMPRESSION) -> None:
    path = db_path(data_dir)
    if not path.exists():
        raise SystemExit(f"missing {path}; run `taxonomy-pipeline build-db` first")

    with duckdb.connect(path) as con:
        start = time.perf_counter()
        cols = con.execute(
            "SELECT coalesce(parent_id, -1) AS parent, depth FROM node ORDER BY id"
        ).fetchnumpy()
        layout = compute(cols["parent"].tolist(), cols["depth"].tolist(), compression)
        print(f"  computed layout in {time.perf_counter() - start:.1f}s")

        parquet = data_dir / "build" / "layout.parquet"
        parquet.parent.mkdir(parents=True, exist_ok=True)
        pl.DataFrame(
            {
                "id": np.arange(len(layout.r), dtype=np.int32),
                "a0": layout.a0,
                "a1": layout.a1,
                "r": layout.r,
                "tips": layout.tips,
                "height": layout.height,
            }
        ).write_parquet(parquet)
        con.execute(
            "CREATE OR REPLACE TABLE layout AS SELECT * FROM read_parquet(?) ORDER BY id",
            [str(parquet)],
        )
        con.execute("ALTER TABLE layout ADD PRIMARY KEY (id)")
        con.execute(
            "CREATE OR REPLACE TABLE layout_meta AS SELECT ? AS compression",
            [compression],
        )
        _report(con)


def _report(con: duckdb.DuckDBPyConnection) -> None:
    rows = con.execute(
        """
        SELECT t.name, l.tips, l.a1 - l.a0 AS share
        FROM layout l JOIN tree t USING (id)
        WHERE t.name IN ('Bacteria', 'Archaea', 'Eukaryota', 'Metazoa', 'Fungi',
                         'Chloroplastida', 'Insecta', 'Mammalia', 'Aves', 'Homo sapiens')
          AND t.rank NOT IN ('genus', 'species') OR t.name = 'Homo sapiens'
        ORDER BY l.a1 - l.a0 DESC
        """
    ).fetchall()
    total = con.execute("SELECT tips FROM layout WHERE id = 0").fetchone()[0]
    print(f"    {'clade':<16}{'species':>12}{'% species':>11}{'% circle':>10}")
    for name, tips, share in rows:
        print(
            f"    {name:<16}{tips:>12,}{100 * tips / total:>10.3f}%{100 * share:>9.3f}%"
        )
