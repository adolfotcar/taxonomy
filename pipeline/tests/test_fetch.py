import io
import tarfile

from taxonomy_pipeline.fetch import extract
from taxonomy_pipeline.sources import SOURCES, Source


def _make_tgz(path, members: dict[str, bytes]) -> None:
    with tarfile.open(path, "w:gz") as tar:
        for name, data in members.items():
            info = tarfile.TarInfo(name)
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))


def test_source_filename_and_stem():
    src = Source("x", "https://example.org/a/b/opentree16.1_tree.tgz", "")
    assert src.filename == "opentree16.1_tree.tgz"
    assert src.stem == "opentree16.1_tree"


def test_sources_have_unique_names():
    names = [s.name for s in SOURCES]
    assert len(names) == len(set(names))


def test_extract_unpacks_and_is_idempotent(tmp_path):
    archive = tmp_path / "data.tgz"
    _make_tgz(archive, {"dir/hello.txt": b"hi"})

    dest = extract(archive, tmp_path / "raw", "data")
    assert (dest / "dir" / "hello.txt").read_bytes() == b"hi"
    assert (dest / ".extracted").exists()

    (dest / "dir" / "hello.txt").write_bytes(b"changed")
    extract(archive, tmp_path / "raw", "data")  # skipped: marker present
    assert (dest / "dir" / "hello.txt").read_bytes() == b"changed"


def test_extract_rejects_path_traversal(tmp_path):
    archive = tmp_path / "evil.tgz"
    _make_tgz(archive, {"../escape.txt": b"x"})
    try:
        extract(archive, tmp_path / "raw", "evil")
    except tarfile.FilterError:
        pass
    else:
        raise AssertionError("expected FilterError")
    assert not (tmp_path / "escape.txt").exists()
