"""Build the master DuckDB database from the downloaded sources.

Tables:
    taxon  Open Tree Taxonomy (OTT): every named taxon with its parent, rank, flags.
    node   The synthetic tree (phylogeny): one row per node, ``id``/``parent_id``
           in preorder (root = 0). ``ott_id`` links to ``taxon`` when the node is a
           named taxon; unnamed clades have ``ott_id`` NULL and an ``mrcaott…`` label.
    meta   Source versions and build time.
View:
    tree   ``node`` joined with names/ranks/flags from ``taxon``.
"""

import re
import time
from datetime import UTC, datetime
from pathlib import Path

import duckdb
import polars as pl

from . import newick
from .sources import OPENTREE_SYNTH, OTT_VERSION

_OTT_LABEL = re.compile(r"ott(\d+)")


def tree_file(data_dir: Path) -> Path:
    return (
        data_dir
        / "raw"
        / f"{OPENTREE_SYNTH}_tree"
        / f"{OPENTREE_SYNTH}_tree"
        / "labelled_supertree"
        / "labelled_supertree.tre"
    )


def taxonomy_file(data_dir: Path) -> Path:
    return data_dir / "raw" / OTT_VERSION / OTT_VERSION / "taxonomy.tsv"


def db_path(data_dir: Path) -> Path:
    return data_dir / "taxonomy.duckdb"


def nodes_frame(tree: newick.ParsedTree) -> pl.DataFrame:
    ott_ids = [
        int(m.group(1)) if label and (m := _OTT_LABEL.fullmatch(label)) else None
        for label in tree.label
    ]
    return pl.DataFrame(
        {
            "id": pl.Series(range(len(tree)), dtype=pl.Int32),
            "parent_id": pl.Series(tree.parent, dtype=pl.Int32),
            "depth": pl.Series(tree.depth, dtype=pl.Int16),
            "label": pl.Series(tree.label, dtype=pl.String),
            "ott_id": pl.Series(ott_ids, dtype=pl.Int32),
        }
    )


def build(data_dir: Path) -> Path:
    tree_path, tax_path = tree_file(data_dir), taxonomy_file(data_dir)
    for path in (tree_path, tax_path):
        if not path.exists():
            raise SystemExit(f"missing {path}; run `taxonomy-pipeline fetch` first")

    work = data_dir / "build"
    work.mkdir(parents=True, exist_ok=True)
    nodes_parquet = work / "nodes.parquet"

    with _step("parsing tree"):
        tree = newick.parse(tree_path.read_text())
        nodes_frame(tree).write_parquet(nodes_parquet)
        print(f"    {len(tree):,} nodes")
        del tree

    final = db_path(data_dir)
    tmp = final.with_name(final.name + ".tmp")
    tmp.unlink(missing_ok=True)

    with duckdb.connect(tmp) as con:
        with _step("loading taxonomy"):
            con.execute(
                """
                CREATE TABLE taxon AS
                SELECT
                    uid::INTEGER                    AS ott_id,
                    parent_uid::INTEGER             AS parent_ott_id,
                    name,
                    rank,
                    uniqname                        AS unique_name,
                    sourceinfo                      AS sources,
                    coalesce(string_split(flags, ','), [])::VARCHAR[] AS flags
                FROM read_csv(?, delim = '\t|\t', header = true, quote = '',
                              all_varchar = true)
                """,
                [str(tax_path)],
            )
            con.execute("ALTER TABLE taxon ADD PRIMARY KEY (ott_id)")

        with _step("loading tree"):
            con.execute(
                "CREATE TABLE node AS SELECT * FROM read_parquet(?) ORDER BY id",
                [str(nodes_parquet)],
            )
            con.execute("ALTER TABLE node ADD PRIMARY KEY (id)")

        con.execute(
            """
            CREATE VIEW tree AS
            SELECT n.id, n.parent_id, n.depth, n.ott_id, n.label,
                   t.name, t.rank, t.flags
            FROM node n LEFT JOIN taxon t USING (ott_id)
            """
        )
        con.execute(
            "CREATE TABLE meta AS SELECT ? AS opentree_synth, ? AS ott_version, ? AS built_at",
            [OPENTREE_SYNTH, OTT_VERSION, datetime.now(UTC)],
        )
        _report(con)

    tmp.replace(final)
    print(f"wrote {final}")
    return final


def _report(con: duckdb.DuckDBPyConnection) -> None:
    (taxa,) = con.execute("SELECT count(*) FROM taxon").fetchone()
    nodes, named, roots, unmatched, tips, max_depth = con.execute(
        """
        SELECT count(*),
               count(ott_id),
               count(*) FILTER (parent_id IS NULL),
               count(*) FILTER (ott_id IS NOT NULL AND ott_id NOT IN (SELECT ott_id FROM taxon)),
               count(*) FILTER (id NOT IN (SELECT parent_id FROM node WHERE parent_id IS NOT NULL)),
               max(depth)
        FROM node
        """
    ).fetchone()
    print(f"    taxon: {taxa:,} rows")
    print(
        f"    node:  {nodes:,} rows, {tips:,} tips, {named:,} named, max depth {max_depth}"
    )
    if roots != 1:
        print(f"    WARNING: expected 1 root, found {roots}")
    if unmatched:
        print(
            f"    WARNING: {unmatched:,} tree nodes reference OTT ids missing from taxonomy"
        )


class _step:
    def __init__(self, what: str) -> None:
        self.what = what

    def __enter__(self) -> None:
        print(f"  {self.what}…")
        self.start = time.perf_counter()

    def __exit__(self, *exc) -> None:
        if exc[0] is None:
            print(f"    done in {time.perf_counter() - self.start:.1f}s")
