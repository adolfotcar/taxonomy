# taxonomy-pipeline

Offline build: downloads source data, builds the tree in DuckDB, computes the
radial layout and writes static tiles + search index for the web app.

```sh
uv sync
uv run taxonomy-pipeline
uv run pytest
uv run ruff check .
```
