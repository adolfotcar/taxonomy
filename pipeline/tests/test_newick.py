import pytest

from taxonomy_pipeline import newick


def test_parses_preorder_with_internal_labels():
    t = newick.parse("((a,b)ab,c)root;")
    assert t.label == ["root", "ab", "a", "b", "c"]
    assert t.parent == [None, 0, 1, 1, 0]
    assert t.depth == [0, 1, 2, 2, 1]


def test_unlabelled_internal_nodes_and_branch_lengths():
    t = newick.parse("((a:1.5,b:2)  ,c:0.1);\n")
    assert t.label == [None, None, "a", "b", "c"]
    assert t.parent == [None, 0, 1, 1, 0]


def test_deep_tree_does_not_recurse():
    depth = 50_000
    t = newick.parse("(" * depth + "x" + ")" * depth + ";")
    assert len(t) == depth + 1
    assert max(t.depth) == depth


@pytest.mark.parametrize("bad", ["(a,b", "(a,b));", "(a,b)", "a,b;", "(a);x"])
def test_rejects_malformed(bad):
    with pytest.raises(ValueError):
        newick.parse(bad)
