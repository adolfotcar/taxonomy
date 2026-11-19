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

    args = parser.parse_args(argv)

    if args.command == "fetch":
        from .fetch import fetch_all

        fetch_all(args.data_dir)
