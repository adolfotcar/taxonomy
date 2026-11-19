# taxonomy-pipeline

Offline build: downloads source data, builds the tree in DuckDB, computes the
radial layout and writes static tiles + search index for the web app.

```sh
uv sync
uv run taxonomy-pipeline fetch   # download source data into data/
uv run taxonomy-pipeline build-db  # build data/taxonomy.duckdb
uv run taxonomy-pipeline layout    # radial layout (table `layout`)
uv run taxonomy-pipeline preview   # PNG preview in data/build/
uv run pytest
uv run ruff check .
```

After rebuilding the tiles, publish them from the repo root:

```sh
firebase deploy --only hosting:data
```

