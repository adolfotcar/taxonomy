"""Render a static PNG of the radial layout, to eyeball it without the web app."""

import math
from pathlib import Path

import duckdb
from PIL import Image, ImageDraw, ImageFont

from .build_db import db_path
from .features import GROUPS, NO_GROUP_COLOUR, group_index, load_signposts, resolve_name

BACKGROUND = (12, 14, 20)


def render(data_dir: Path, out: Path, size: int = 3000, min_share: float = 2e-5) -> None:
    with duckdb.connect(db_path(data_dir), read_only=True) as con:
        edges = con.execute(
            """
            SELECT l.id, l.a0, l.a1, l.r, pl.a0, pl.a1, pl.r
            FROM layout l
            JOIN node n USING (id)
            JOIN layout pl ON pl.id = n.parent_id
            WHERE l.a1 - l.a0 >= ?
            """,
            [min_share],
        ).fetchall()
        group_of = group_index(con)
        group_labels = []
        for group in GROUPS:
            node = resolve_name(con, group.taxon)
            if node is not None:
                row = con.execute("SELECT a0, a1, r FROM layout WHERE id = ?", [node]).fetchone()
                group_labels.append((group.label, group.colour, *row))
        signposts = []
        for sp in load_signposts():
            node = resolve_name(con, sp["name"])
            if node is None:
                print(f"    signpost not found in tree: {sp['name']}")
                continue
            row = con.execute("SELECT a0, a1, r FROM layout WHERE id = ?", [node]).fetchone()
            signposts.append((sp["common"], *row))

    colours = [NO_GROUP_COLOUR, *(g.colour for g in GROUPS)]
    img = Image.new("RGB", (size, size), BACKGROUND)
    draw = ImageDraw.Draw(img, "RGBA")
    cx = cy = size / 2
    radius = size * 0.40

    def deg(turns: float) -> float:
        return turns * 360 - 90  # 0 turns = 12 o'clock, clockwise

    def point(turns: float, r: float) -> tuple[float, float]:
        a = math.radians(deg(turns))
        return cx + radius * r * math.cos(a), cy + radius * r * math.sin(a)

    for node, a0, a1, r, pa0, pa1, pr in edges:
        mid, pmid = (a0 + a1) / 2, (pa0 + pa1) / 2
        rgb = colours[group_of[node]]
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

    for label, colour, a0, a1, r in group_labels:
        x, y = point((a0 + a1) / 2, max(r, 0.12) + 0.04)
        draw.text((x, y), label, fill=(*colour, 255), font=font_big, anchor="mm")

    for common, a0, a1, _ in signposts:
        mid = (a0 + a1) / 2
        x, y = point(mid, 1.0)
        draw.ellipse([x - 6, y - 6, x + 6, y + 6], fill=(255, 255, 255, 255))
        lx, ly = point(mid, 1.06)
        anchor = "lm" if math.cos(math.radians(deg(mid))) >= 0 else "rm"
        draw.text((lx, ly), common, fill=(235, 235, 235, 255), font=font_small, anchor=anchor)

    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(out)
    print(f"  drew {len(edges):,} branches -> {out}")
