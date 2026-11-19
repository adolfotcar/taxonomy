"""Export the laid-out tree as static tiles for the web viewer.

Level of detail: a node with slice width ``span`` (turns) belongs to level

    L = max(0, ceil(-log2(span * TILE_DETAIL)))

i.e. the coarsest level at which it is at least 1/TILE_DETAIL of a tile wide.
Level ``L`` splits the circle into ``2**L`` equal tiles and a node goes into the
tile containing its mid-angle. The viewer, showing roughly one tile's width on
screen, loads levels 0..L and only the tiles in view, so it gets every branch at
least ~1 px wide.

Output (``<out>/``):
    manifest.json                    current version, groups, signposts, tile list
    <version>/tiles/<L>/<k>.json     columnar node records

Tile records (parallel arrays): ``id``, ``a0`` (slice start, turns), ``span``,
``d`` (gap to the rim, 1 - radius), ``pd``/``pm``/``ps`` (parent gap / mid-angle /
span, to draw the connecting branch), ``tips`` (species below), ``g`` (colour group,
0 = none),
``name`` (null for unnamed clades).
"""

import json
import shutil
import time
from datetime import UTC, datetime
from pathlib import Path

import duckdb
import polars as pl

from .build_db import db_path
from .features import GROUPS, group_index, load_signposts, resolve_name

TILE_DETAIL = 4096
DEFAULT_OUT_DIR = Path(__file__).resolve().parents[3] / "web" / "public" / "data"


def export(data_dir: Path, out_dir: Path = DEFAULT_OUT_DIR) -> Path:
    path = db_path(data_dir)
    if not path.exists():
        raise SystemExit(f"missing {path}; run `taxonomy-pipeline build-db` first")

    start = time.perf_counter()
    with duckdb.connect(path, read_only=True) as con:
        tables = {r[0] for r in con.execute("SHOW TABLES").fetchall()}
        if "layout" not in tables:
            raise SystemExit("missing layout; run `taxonomy-pipeline layout` first")
        synth, ott = con.execute("SELECT opentree_synth, ott_version FROM meta").fetchone()
        compression, fractal = con.execute(
            "SELECT compression, fractal FROM layout_meta"
        ).fetchone()
        version = f"{synth}-c{round(compression * 100)}f{round(fractal * 10)}"

        nodes = _nodes(con, data_dir)
        groups = _groups(con)
        signposts = _signposts(con)

    version_dir = out_dir / version
    if version_dir.exists():
        shutil.rmtree(version_dir)
    # Remove older exports (other versions) so stale tiles are not deployed.
    if out_dir.exists():
        for old in out_dir.iterdir():
            if old.is_dir() and old.name != version and (old / "tiles").is_dir():
                print(f"  removing old export {old.name}")
                shutil.rmtree(old)
    tile_index = _write_tiles(nodes, version_dir / "tiles")

    manifest = {
        "version": version,
        "generated": datetime.now(UTC).isoformat(timespec="seconds"),
        "source": {"opentree": synth, "ott": ott},
        "compression": compression,
        "fractal": fractal,
        "tileDetail": TILE_DETAIL,
        "tilePath": f"{version}/tiles/{{level}}/{{index}}.json",
        "tiles": tile_index,
        "nodeCount": nodes.height,
        "groups": groups,
        "signposts": signposts,
    }
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "manifest.json").write_text(json.dumps(manifest, separators=(",", ":")))

    files = sum(len(v) for v in tile_index.values())
    size = sum(f.stat().st_size for f in version_dir.rglob("*.json"))
    print(
        f"  wrote {files:,} tiles ({size / 1e6:,.0f} MB) in {len(tile_index)} levels "
        f"to {version_dir} in {time.perf_counter() - start:.1f}s"
    )
    return out_dir / "manifest.json"


def _nodes(con: duckdb.DuckDBPyConnection, data_dir: Path) -> pl.DataFrame:
    parquet = data_dir / "build" / "tile_nodes.parquet"
    parquet.parent.mkdir(parents=True, exist_ok=True)
    con.execute(
        f"""
        COPY (
            SELECT l.id, l.a0, l.a1 - l.a0 AS span, l.d,
                   coalesce(pl.d, 1.0) AS pd,
                   coalesce((pl.a0 + pl.a1) / 2, (l.a0 + l.a1) / 2) AS pm,
                   coalesce(pl.a1 - pl.a0, 1.0) AS ps,
                   l.tips, t.name
            FROM layout l
            JOIN tree t USING (id)
            LEFT JOIN layout pl ON pl.id = t.parent_id
            ORDER BY l.id
        ) TO '{parquet}' (FORMAT parquet)
        """
    )
    level = (-(pl.col("span") * TILE_DETAIL).log(2)).ceil().clip(lower_bound=0).cast(pl.Int32)
    return (
        pl.read_parquet(parquet)
        .with_columns(g=pl.Series(group_index(con)), level=level)
        .with_columns(
            index=((pl.col("a0") + pl.col("span") / 2) * 2.0 ** pl.col("level"))
            .floor()
            .cast(pl.Int64)
            .clip(upper_bound=2 ** pl.col("level").cast(pl.Int64) - 1),
            span=pl.col("span").round_sig_figs(7),
            ps=pl.col("ps").round_sig_figs(7),
            d=pl.col("d").round_sig_figs(7),
            pd=pl.col("pd").round_sig_figs(7),
        )
    )


def _write_tiles(nodes: pl.DataFrame, tiles_dir: Path) -> dict[str, list[int]]:
    columns = ["id", "a0", "span", "d", "pd", "pm", "ps", "tips", "g", "name"]
    index: dict[str, list[int]] = {}
    for (level, k), tile in sorted(nodes.partition_by(["level", "index"], as_dict=True).items()):
        path = tiles_dir / str(level) / f"{k}.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        payload = {c: tile.get_column(c).to_list() for c in columns}
        path.write_text(json.dumps(payload, separators=(",", ":")))
        index.setdefault(str(level), []).append(k)
    return index


def _groups(con: duckdb.DuckDBPyConnection) -> list[dict]:
    out = []
    for i, group in enumerate(GROUPS, start=1):
        node = resolve_name(con, group.taxon)
        out.append(
            {
                "g": i,
                "label": group.label,
                "taxon": group.taxon,
                "colour": list(group.colour),
                "node": node,
            }
        )
    return out


def _signposts(con: duckdb.DuckDBPyConnection) -> list[dict]:
    out = []
    for sp in load_signposts():
        node = resolve_name(con, sp["name"])
        if node is None:
            print(f"    signpost not found in tree: {sp['name']}")
            continue
        a0, a1, d = con.execute("SELECT a0, a1, d FROM layout WHERE id = ?", [node]).fetchone()
        out.append(
            {
                "name": sp["name"],
                "common": sp["common"],
                "node": node,
                "a0": a0,
                "span": a1 - a0,
                "d": d,
            }
        )
    return out
