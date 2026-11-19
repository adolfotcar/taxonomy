import argparse
from pathlib import Path

DEFAULT_DATA_DIR = Path(__file__).resolve().parents[2] / "data"


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        prog="taxonomy-pipeline",
        description="Build the tree-of-life data for the web app.",
    )
    parser.add_argument(
        "--data-dir",
        type=Path,
        default=DEFAULT_DATA_DIR,
        help=f"working directory for downloads and build files (default: {DEFAULT_DATA_DIR})",
    )
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("fetch", help="download and extract the source datasets")
    commands.add_parser("build-db", help="build the master DuckDB database from the sources")

    layout_cmd = commands.add_parser("layout", help="compute the radial layout")
    layout_cmd.add_argument(
        "--compression",
        type=float,
        default=None,
        help="slice share ∝ species**compression at each split; 1 = proportional, "
        "lower = more room for small groups (default: 0.75)",
    )
    layout_cmd.add_argument(
        "--fractal",
        type=float,
        default=None,
        help="self-similar radius: a subtree reaches in from the rim fractal * width**0.9; "
        "0 = branching order only (default: 2)",
    )
    preview_cmd = commands.add_parser("preview", help="render a PNG of the layout")
    preview_cmd.add_argument("--out", type=Path, help="default: <data-dir>/build/preview.png")
    preview_cmd.add_argument("--size", type=int, default=3000, help="image size in px")

    tiles_cmd = commands.add_parser("tiles", help="export tiles for the web viewer")
    tiles_cmd.add_argument("--out", type=Path, help="default: web/public/data")

    args = parser.parse_args(argv)

    if args.command == "fetch":
        from .fetch import fetch_all

        fetch_all(args.data_dir)
    elif args.command == "build-db":
        from .build_db import build

        build(args.data_dir)
    elif args.command == "layout":
        from .layout import DEFAULT_COMPRESSION, DEFAULT_FRACTAL, run

        compression = DEFAULT_COMPRESSION if args.compression is None else args.compression
        fractal = DEFAULT_FRACTAL if args.fractal is None else args.fractal
        run(args.data_dir, compression, fractal)
    elif args.command == "preview":
        from .preview import render

        render(
            args.data_dir,
            args.out or args.data_dir / "build" / "preview.png",
            args.size,
        )
    elif args.command == "tiles":
        from .tiles import DEFAULT_OUT_DIR, export

        export(args.data_dir, args.out or DEFAULT_OUT_DIR)
