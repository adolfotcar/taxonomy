"""Minimal, iterative Newick parser for very large trees.

Supports what the Open Tree synthesis files use: nested parentheses, commas,
node labels and an optional ``:length`` suffix (ignored). No quoted labels or
comments. Iterative, so tree depth is not limited by Python's recursion limit.
"""

import re
from dataclasses import dataclass, field

_TOKEN = re.compile(r"[(),;]|[^(),;]+")


@dataclass
class ParsedTree:
    """Nodes in preorder: index ``i`` is the node id; the root is 0."""

    parent: list[int | None] = field(default_factory=list)
    label: list[str | None] = field(default_factory=list)
    depth: list[int] = field(default_factory=list)

    def __len__(self) -> int:
        return len(self.parent)


def parse(text: str) -> ParsedTree:
    tree = ParsedTree()
    stack: list[int] = []  # open internal nodes
    just_closed: int | None = None  # node whose ")" was the previous token
    finished = False

    def new_node() -> int:
        node = len(tree.parent)
        tree.parent.append(stack[-1] if stack else None)
        tree.label.append(None)
        tree.depth.append(len(stack))
        return node

    for match in _TOKEN.finditer(text):
        token = match.group()
        if finished:
            if token.strip():
                raise ValueError(
                    f"unexpected content after ';' at offset {match.start()}"
                )
            continue
        if token == "(":
            stack.append(new_node())
            just_closed = None
        elif token == ")":
            if not stack:
                raise ValueError(f"unbalanced ')' at offset {match.start()}")
            just_closed = stack.pop()
        elif token == ",":
            if not stack:
                raise ValueError(f"',' outside parentheses at offset {match.start()}")
            just_closed = None
        elif token == ";":
            finished = True
        else:
            name = token.strip().split(":", 1)[0] or None
            if just_closed is not None:
                tree.label[just_closed] = name
                just_closed = None
            elif name is not None:
                tree.label[new_node()] = name

    if stack:
        raise ValueError(f"{len(stack)} unclosed '(' at end of input")
    if not finished:
        raise ValueError("missing terminating ';'")
    return tree
