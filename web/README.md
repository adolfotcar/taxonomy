# taxonomy-web

Zoomable radial tree-of-life viewer (React + TypeScript + Vite, drawn with Canvas 2D).

Needs the generated data in `public/data/` — run the pipeline first
(`uv run taxonomy-pipeline tiles` in `../pipeline`).

```sh
npm install
npm run dev     # dev server
npm test        # unit tests (vitest)
npm run lint    # oxlint
npm run build   # type-check + production build into dist/
```

Set `VITE_DATA_URL` to load the data from somewhere other than `/data`
(e.g. a Cloud Storage bucket).

The current view is kept in the URL (`#v=x,y,log2scale`), so any spot on the tree
can be shared as a link.
