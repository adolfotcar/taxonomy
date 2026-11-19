"""Source datasets the pipeline downloads.

Bump the versions here to move to a newer Open Tree of Life release.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class Source:
    name: str
    url: str
    description: str

    @property
    def filename(self) -> str:
        return self.url.rsplit("/", 1)[-1]

    @property
    def stem(self) -> str:
        return self.filename.removesuffix(".tgz")


OPENTREE_SYNTH = "opentree16.1"
OTT_VERSION = "ott3.7.3"

SOURCES: tuple[Source, ...] = (
    Source(
        name="tree",
        url=f"https://files.opentreeoflife.org/synthesis/{OPENTREE_SYNTH}/{OPENTREE_SYNTH}_tree.tgz",
        description=f"Open Tree of Life synthetic tree ({OPENTREE_SYNTH})",
    ),
    Source(
        name="taxonomy",
        url=f"https://files.opentreeoflife.org/ott/{OTT_VERSION}/{OTT_VERSION}.tgz",
        description=f"Open Tree Taxonomy ({OTT_VERSION})",
    ),
)
