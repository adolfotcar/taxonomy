"""Render a static PNG of the radial layout, to eyeball it without the web app."""

import math
import tomllib
from pathlib import Path

import duckdb
from PIL import Image, ImageDraw, ImageFont

from .build_db import db_path

SIGNPOSTS_FILE = Path(__file__).resolve().parents[2] / "signposts.toml"

# Major groups → colour. Later entries win (they are nested inside earlier ones).
GROUPS: list[tuple[str, tuple[int, int, int]]] = [
    ("Bacteria", (66, 133, 160)),
    ("Archaea", (150, 110, 190)),
    ("Eukaryota", (140, 140, 140)),
    ("Chloroplastida", (70, 150, 70)),
    ("Fungi", (190, 130, 50)),
    ("Metazoa", (200, 80, 80)),
    ("Insecta", (220, 150, 60)),
    ("Chordata", (90, 110, 210)),
]
BACKGROUND = (12, 14, 20)


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


def render(
    data_dir: Path, out: Path, size: int = 3000, min_share: float = 2e-5
) -> None:
    with duckdb.connect(db_path(data_dir), read_only=True) as con:
        edges = con.execute(
            """
            SELECT l.a0, l.a1, l.r, pl.a0, pl.a1, pl.r
            FROM layout l
            JOIN node n USING (id)
            JOIN layout pl ON pl.id = n.parent_id
            WHERE l.a1 - l.a0 >= ?
            """,
            [min_share],
        ).fetchall()
        groups = []
        for name, colour in GROUPS:
            row = con.execute(
                """SELECT l.a0, l.a1, l.r FROM tree t JOIN layout l USING (id)
                   WHERE t.name = ? ORDER BY l.tips DESC LIMIT 1""",
                [name],
            ).fetchone()
            if row:
                groups.append((name, colour, *row))
            else:
                print(f"    group not found in tree: {name}")
        signposts = []
        for sp in load_signposts():
            node = resolve_name(con, sp["name"])
            if node is None:
                print(f"    signpost not found in tree: {sp['name']}")
                continue
            row = con.execute(
                "SELECT a0, a1, r FROM layout WHERE id = ?", [node]
            ).fetchone()
            signposts.append((sp["common"], *row))

    img = Image.new("RGB", (size, size), BACKGROUND)
    draw = ImageDraw.Draw(img, "RGBA")
    cx = cy = size / 2
    radius = size * 0.40

    def deg(turns: float) -> float:
        return turns * 360 - 90  # 0 turns = 12 o'clock, clockwise

    def point(turns: float, r: float) -> tuple[float, float]:
        a = math.radians(deg(turns))
        return cx + radius * r * math.cos(a), cy + radius * r * math.sin(a)

    def colour_for(mid: float) -> tuple[int, int, int]:
        colour = (110, 110, 110)
        for _, c, a0, a1, _ in groups:
            if a0 <= mid < a1:
                colour = c
        return colour

    for a0, a1, r, pa0, pa1, pr in edges:
        mid, pmid = (a0 + a1) / 2, (pa0 + pa1) / 2
        rgb = colour_for(mid)
        width = max(1, round(3 * (a1 - a0) ** 0.25))
        draw.line([point(mid, pr), point(mid, r)], fill=(*rgb, 170), width=width)
        lo, hi = sorted((deg(mid), deg(pmid)))
        if hi - lo > 0.01:
            rr = radius * pr
            draw.arc(
                [cx - rr, cy - rr, cx + rr, cy + rr],
                lo,
                hi,
                fill=(*rgb, 170),
                width=width,
            )

    font_big = ImageFont.load_default(size=size / 75)
    font_small = ImageFont.load_default(size=size / 110)

    for name, colour, a0, a1, r in groups:
        x, y = point((a0 + a1) / 2, max(r, 0.12) + 0.04)
        draw.text((x, y), name, fill=(*colour, 255), font=font_big, anchor="mm")

    for common, a0, a1, _ in signposts:
        mid = (a0 + a1) / 2
        x, y = point(mid, 1.0)
        draw.ellipse([x - 6, y - 6, x + 6, y + 6], fill=(255, 255, 255, 255))
        lx, ly = point(mid, 1.06)
        anchor = "lm" if math.cos(math.radians(deg(mid))) >= 0 else "rm"
        draw.text(
            (lx, ly), common, fill=(235, 235, 235, 255), font=font_small, anchor=anchor
        )

    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(out)
    print(f"  drew {len(edges):,} branches -> {out}")
