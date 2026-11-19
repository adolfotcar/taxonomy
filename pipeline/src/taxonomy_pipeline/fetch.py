"""Download and unpack source datasets into the pipeline data directory.

Layout:
    data/downloads/<file>.tgz   raw archives (resumable downloads)
    data/raw/<stem>/...         extracted contents
"""

import shutil
import sys
import tarfile
import urllib.request
from pathlib import Path

from .sources import SOURCES, Source

CHUNK = 1 << 20  # 1 MiB
USER_AGENT = "taxonomy-pipeline/0.1"


def download(source: Source, downloads_dir: Path) -> Path:
    """Download ``source`` into ``downloads_dir``, resuming a partial file if present."""
    downloads_dir.mkdir(parents=True, exist_ok=True)
    target = downloads_dir / source.filename
    partial = target.with_name(target.name + ".part")

    if target.exists():
        print(f"  already downloaded: {target.name}")
        return target

    offset = partial.stat().st_size if partial.exists() else 0
    headers = {"User-Agent": USER_AGENT}
    if offset:
        headers["Range"] = f"bytes={offset}-"

    request = urllib.request.Request(source.url, headers=headers)
    with urllib.request.urlopen(request, timeout=60) as response:
        if offset and response.status != 206:
            offset = 0  # server ignored the Range header; start over
        total = response.length + offset if response.length is not None else None
        mode = "ab" if offset else "wb"
        done = offset
        with partial.open(mode) as out:
            while chunk := response.read(CHUNK):
                out.write(chunk)
                done += len(chunk)
                _progress(source.filename, done, total)
    print()

    partial.rename(target)
    return target


def extract(archive: Path, raw_dir: Path, stem: str) -> Path:
    """Extract ``archive`` into ``raw_dir/<stem>``, skipping if already extracted."""
    dest = raw_dir / stem
    marker = dest / ".extracted"
    if marker.exists():
        print(f"  already extracted: {dest}")
        return dest

    if dest.exists():
        shutil.rmtree(dest)  # leftover from an interrupted extraction
    dest.mkdir(parents=True)
    print(f"  extracting {archive.name} -> {dest}")
    with tarfile.open(archive) as tar:
        # The "data" filter rejects absolute paths, links outside dest, devices, etc.
        tar.extractall(dest, filter="data")
    marker.touch()
    return dest


def fetch_all(data_dir: Path) -> None:
    for source in SOURCES:
        print(f"{source.name}: {source.description}")
        archive = download(source, data_dir / "downloads")
        extract(archive, data_dir / "raw", source.stem)


def _progress(name: str, done: int, total: int | None) -> None:
    mb = done / 1e6
    if total:
        pct = 100 * done / total
        sys.stdout.write(f"\r  {name}: {mb:,.1f} / {total / 1e6:,.1f} MB ({pct:5.1f}%)")
    else:
        sys.stdout.write(f"\r  {name}: {mb:,.1f} MB")
    sys.stdout.flush()
