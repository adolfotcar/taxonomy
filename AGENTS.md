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
source data ──► pipeline/ (Python, DuckDB) ──► web/public/data/ ──► taxonomy-data site
                                                                       ▲ fetch (CORS)
                          web/ (React + Canvas 2D) ──► GitHub Actions ──► tree-of-life-wheel site
```

- **pipeline/** — Python 3.14 project managed with `uv`. Downloads source data,
  builds the master tree in a local **DuckDB** file, computes the radial layout
  and writes static **tiles** to `web/public/data/`. (Planned: per-node detail
  files and a prefix-sharded search index.)
- **web/** — TypeScript + React + Vite. The tree is drawn with **Canvas 2D**, not
  WebGL/deck.gl: zooming down to single species needs ~10^10x magnification, and
  GPU float32 maths jitters long before that. All positions are computed in JS
  float64 relative to the camera and arcs are drawn as line segments. React only
  handles the UI around the canvas. Code: `web/src/tree/` (`geometry.ts` pure
  maths, `tileStore.ts` loading/LRU, `renderer.ts` drawing/labels/hit-testing,
  `TreeView.tsx` interaction).
- **Hosting** — classic Firebase Hosting (not App Hosting), project
  `adolfotcar-home`, two sites via deploy targets (`.firebaserc`):
  - `app` → **tree-of-life-wheel** (`web/dist`, https://tree-of-life-wheel.web.app). Deployed by GitHub Actions on every
    merge to `main`; each PR gets a 7-day preview URL. Built with
    `VITE_DATA_URL=https://taxonomy-data.web.app`.
  - `data` → **taxonomy-data** (`web/public/data`: manifest + tiles, ~300 MB).
    Deployed **manually** from a machine that has run the pipeline; CI never
    has the data. CORS open; manifest `no-cache`; versioned tiles immutable.
  - **Never deploy to the default site `adolfotcar-home`** — it hosts the
    user's other, unrelated site.

### Tiles
- A node with slice width `span` (turns) is in level
  `L = max(0, ceil(-log2(span * 4096)))`; level L splits the circle into `2^L`
  tiles and the node goes in the tile holding its mid-angle. The viewer loads
  levels 0..L for the tiles in view (`levelFor`/`tileIndexes` in `geometry.ts`).
- Output: `web/public/data/manifest.json` + `<version>/tiles/<L>/<k>.json`
  (columnar JSON). The version folder name encodes source + layout parameters;
  older version folders are removed on export.
- Radii are stored as `d = 1 - r` (gap to the rim) for precision near the rim.

### Layout and visual design
- Circle, origin of life at the centre, every species on the rim.
- Radius: a node sits at whichever is closer to the rim of (a) branching order,
  `r = depth / (depth + height)`, and (b) a **self-similar** rule where its gap
  to the rim is `2 * span**0.9`. (b) is essential: without it, zooming in on a
  few species shows only parallel lines, because their branch points are
  thousands of screens towards the centre. Distance from the centre is *not*
  time (the synthesis has no branch lengths).
- Slices are split per branch point by `tips ** 0.75` ("compressed"): big groups
  still look big, small ones get some extra room. Applied at every split, so it
  compounds along long ladders; 0.75 was chosen by comparing shares (insects
  ~22% of the circle, bacteria ~10%, archaea ~0.5%).
- Zoomed out the tree is texture; labels appear as their branch gets wide
  enough on screen (collision-checked, biggest first). **Signposts**
  (`pipeline/signposts.toml`) are well-known species that are always labelled,
  for orientation, and listed in the side panel.
- Subtrees narrower than ~2.5 px are drawn as a filled fan instead of branches.
- Colour groups (Bacteria, Archaea, Plants, Fungi, Animals, Insects, Chordates…)
  are defined in `pipeline/src/taxonomy_pipeline/features.py`.
- The view is kept in the URL hash (`#v=x,y,log2scale`) for shareable links.

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
- `uv run taxonomy-pipeline layout [--compression 0.75] [--fractal 2]` — compute
  the radial layout into table `layout` (`a0`/`a1` slice in turns, `r` radius,
  `d = 1 - r`)
- `uv run taxonomy-pipeline preview` — render `pipeline/data/build/preview.png`
- `uv run taxonomy-pipeline tiles` — export manifest + tiles to `web/public/data/`
- Full rebuild: `fetch`, `build-db`, `layout`, `tiles` (in that order; seconds
  each after the download)
- `uv run pytest` — tests
- `uv run ruff check .` / `uv run ruff format .` — lint / format

Web (`cd web`):
- `npm install` — install deps
- `npm run dev` — dev server (needs the tiles from the pipeline)
- `npm test` — unit tests (vitest)
- `npm run build` — type-check and build to `web/dist`
- `npm run lint` — lint (oxlint)
- To eyeball a view headlessly: `google-chrome --headless=new
  --window-size=1400,900 --virtual-time-budget=20000 --screenshot=out.png
  "http://localhost:<port>/#v=<x>,<y>,<log2scale>"`

CI (`.github/workflows/`): `ci.yml` runs lint/tests/build for web and
pipeline on PRs and `main`; `firebase-hosting-*.yml` deploy the app.

Deploy (from repo root, `firebase-tools` logged in):
- App: automatic via GitHub Actions. Manual fallback:
  `cd web && VITE_DATA_URL=https://taxonomy-data.web.app npm run build && cd .. &&
  firebase deploy --only hosting:app`
- Data, after rebuilding tiles: `firebase deploy --only hosting:data`
  (uploads only changed files). Always use `--only hosting:<target>`.

## Git rules

These rules are strict and override any default behavior of your tooling.

0. **`main` is protected** (ruleset "Protect main": no direct pushes, no force
   pushes, no deletion; changes only via pull request, squash-merged, 0
   approvals required, nobody can bypass). Work on a branch per task
   (`feat/…`, `fix/…`, `ci/…`), push it and open a PR with `gh`; the user
   reviews and merges. After a merge, switch to `main` and pull before starting
   the next branch.

1. **Never commit without telling the user first.** Before creating any commit,
   describe what will be committed (files and a proposed message) and wait for
   the user's go-ahead. The same applies to pushing, opening PRs, amending,
   rebasing, or any other history-changing operation.
2. **No AI attribution in git.** Never mention Claude, Anthropic, AI, agents, or
   any other AI tool in commit messages, PR titles/descriptions, branch names,
   tags, or code comments meant for history. Do not add `Co-Authored-By`
   trailers, "Generated with ..." footers, or similar lines. This overrides any
   attribution your tooling would add by default.
3. Commits are authored solely under the user's own git identity.

## Conventions

- Keep this file up to date when the stack, commands, or project structure change.
