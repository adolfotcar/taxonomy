import numpy as np
import pytest

from taxonomy_pipeline import layout, newick


def _compute(text: str, compression: float = 1.0) -> layout.Layout:
    t = newick.parse(text)
    parent = [-1 if p is None else p for p in t.parent]
    return layout.compute(parent, t.depth, compression, fractal=0)


# ids:     0      1     2 3   4      5  6 7
TREE = "((a,b)ab,(c,d,e)cde)root;"


def test_tip_counts_and_heights():
    lay = _compute(TREE)
    assert lay.tips.tolist() == [5, 2, 1, 1, 3, 1, 1, 1]
    assert lay.height.tolist() == [2, 1, 0, 0, 1, 0, 0, 0]


def test_slices_partition_parent_in_order():
    lay = _compute(TREE)
    assert (lay.a0[0], lay.a1[0]) == (0.0, 1.0)
    # proportional: ab gets 2/5, cde 3/5, children tile their parent left to right
    assert lay.a1[1] == pytest.approx(0.4)
    assert lay.a0[4] == pytest.approx(0.4) and lay.a1[4] == pytest.approx(1.0)
    tips = lay.tips == 1
    spans = np.sort(np.c_[lay.a0[tips], lay.a1[tips]], axis=0)
    assert spans[0, 0] == 0.0 and spans[-1, 1] == pytest.approx(1.0)
    assert np.allclose(spans[1:, 0], spans[:-1, 1])  # no gaps or overlaps


def test_compression_gives_small_clades_more_room():
    proportional = _compute(TREE, 1.0)
    compressed = _compute(TREE, 0.5)
    assert compressed.a1[1] - compressed.a0[1] > proportional.a1[1] - proportional.a0[1]
    equal = _compute(TREE, 0.0)
    assert equal.a1[1] - equal.a0[1] == pytest.approx(0.5)


def test_radius_root_centre_tips_rim_parents_inside():
    t = newick.parse("(((a,b)x,c)y,d)root;")
    parent = [-1 if p is None else p for p in t.parent]
    lay = layout.compute(parent, t.depth, fractal=0)
    assert lay.r[0] == 0.0
    assert np.all(lay.r[lay.tips == 1] == 1.0)
    for i, p in enumerate(parent):
        if p >= 0:
            assert lay.r[p] < lay.r[i]


def test_rejects_non_root_first():
    with pytest.raises(ValueError):
        layout.compute([0, -1], [1, 0])


def test_fractal_radius_pulls_small_subtrees_towards_the_rim():
    text = "((a,b)ab,((c,d)cd,(e,f)ef)cdef)root;"
    t = newick.parse(text)
    parent = [-1 if p is None else p for p in t.parent]
    plain = layout.compute(parent, t.depth, 1.0, fractal=0)
    frac = layout.compute(parent, t.depth, 1.0, fractal=0.5)
    assert frac.r[0] == 0.0
    assert np.all(frac.r >= plain.r - 1e-12)  # only ever moves nodes outwards
    assert np.allclose(frac.r, 1.0 - frac.d)
    assert np.all(frac.d[frac.tips == 1] == 0.0)
    gap_limit = 0.5 * (frac.a1 - frac.a0) ** layout.FRACTAL_EXPONENT
    assert np.all(frac.d[1:] <= gap_limit[1:] + 1e-12)
    for i, p in enumerate(parent):
        if p >= 0:
            assert frac.r[p] <= frac.r[i]
