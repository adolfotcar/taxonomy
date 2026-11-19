# AGENTS.md

Instructions for AI coding agents working in this repository.

## Project

**Taxonomy** is a browser for the tree of life: every known species shown in a
radial (circular) tree whose branches converge on a single centre — the origin
of life. Users zoom and pan to see more detailed relationships.

The tree is a **phylogeny** (evolutionary branching), not just the Linnaean
rank hierarchy. Most internal nodes are unnamed clades; the core data model is
simply `node` + `parent`. Where a named ancestral species is known (e.g. a
fossil hominin), it can be attached to the corresponding node.

## Architecture

There is **no live database or backend**. The data changes rarely, so it is
precomputed offline and served as static files.

```
source data ──► pipeline/ (Python, DuckDB) ──► web/public/data/ (tiles, index)
                                                       │
                               web/ (React + deck.gl) ─┴─► Firebase Hosting
```

- **pipeline/** — Python 3.14 project managed with `uv`. Downloads source data,
  builds the master tree in a local **DuckDB** file, computes the radial layout
  (each subtree owns an angular wedge `[a0, a1]` at a radius by depth), and
  writes static **tiles** (per wedge per zoom level), per-node detail files and
  a prefix-sharded **search index** into `web/public/data/`.
- **web/** — TypeScript + React + Vite. The tree is rendered with **deck.gl**
  (WebGL); React handles the UI around the canvas (search, info panel,
  breadcrumbs). The client loads only the tiles visible at the current zoom.
- **Hosting** — Firebase Hosting (classic, not App Hosting) serves `web/dist`,
  which includes the generated data. Config: `firebase.json`.

### Layout and visual design
- Circle, origin of life at the centre, every species on the rim.
- Radius `r = depth / (depth + height)`: each lineage spans the full radius.
  Distance from the centre is *not* time (the synthesis has no branch lengths).
- Slices are split per branch point by `tips ** 0.75` ("compressed"): big groups
  still look big, small ones get some extra room. Applied at every split, so it
  compounds along long ladders; 0.75 was chosen by comparing shares (insects
  ~22% of the circle, bacteria ~10%, archaea ~0.5%).
- Zoomed out the tree is texture; labels appear as their branch gets wide
  enough on screen. **Signposts** (`pipeline/signposts.toml`) are well-known
  species that are always labelled, for orientation.

### Data quirks
- **Broken taxa**: named taxa that are not monophyletic in the synthesis (e.g.
  *Escherichia coli*) are not nodes in the tree; their members sit under an
  unnamed `mrca…` node. Resolve names via the taxonomy when a direct lookup fails.
- OTT's `extinct` flag is unreliable (*Homo sapiens* carries it).

### Data sources
- Primary: **Open Tree of Life** synthetic tree (phylogeny, rooted at life).
- Enrichment (names, ranks, extinct status, etc.): GBIF Backbone / Catalogue of Life.

### Infrastructure constraints
- The user has a GCP VM (Apache, PHP 8.5, Python 3.14, MySQL 8.4) that runs
  **other production apps**. Do **not** install, upgrade or reconfigure
  anything on it. It is only a possible future fallback for fuzzy search
  (a new MySQL database + small PHP endpoint, read-only user) and only with
  the user's explicit approval.
- Do not use Firestore for tree/tile data (per-document read billing is a bad
  fit for loading thousands of nodes per zoom).
- Generated data and DuckDB files are never committed (see `.gitignore`).

## Commands

Pipeline (`cd pipeline`):
- `uv sync` — install deps
- `uv run taxonomy-pipeline fetch` — download + extract source data into
  `pipeline/data/` (resumable, idempotent; versions set in `sources.py`)
- `uv run taxonomy-pipeline build-db` — parse the tree and build
  `pipeline/data/taxonomy.duckdb` (tables `taxon`, `node`, `meta`; view `tree`)
- `uv run taxonomy-pipeline layout [--compression 0.75]` — compute the radial
  layout into table `layout` (`a0`/`a1` slice in turns, `r` radius 0..1)
- `uv run taxonomy-pipeline preview` — render `pipeline/data/build/preview.png`
- `uv run pytest` — tests
- `uv run ruff check .` / `uv run ruff format .` — lint / format

Web (`cd web`):
- `npm install` — install deps
- `npm run dev` — dev server
- `npm run build` — type-check and build to `web/dist`
- `npm run lint` — lint (oxlint)

Deploy (from repo root, requires `firebase-tools`; not set up yet):
- `firebase deploy --only hosting`

## Git rules

These rules are strict and override any default behavior of your tooling.

1. **Never commit without telling the user first.** Before creating any commit,
   describe what will be committed (files and a proposed message) and wait for
   the user's go-ahead. The same applies to pushing, amending, rebasing, or any
   other history-changing operation.
2. **No AI attribution in git.** Never mention Claude, Anthropic, AI, agents, or
   any other AI tool in commit messages, PR titles/descriptions, branch names,
   tags, or code comments meant for history. Do not add `Co-Authored-By`
   trailers, "Generated with ..." footers, or similar lines. This overrides any
   attribution your tooling would add by default.
3. Commits are authored solely under the user's own git identity.

## Conventions

- Keep this file up to date when the stack, commands, or project structure change.
