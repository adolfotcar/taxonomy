import { useEffect, useRef, useState } from 'react'
import { TreeView, type TreeViewHandle } from './tree/TreeView'
import type { Manifest } from './tree/types'

const DATA_URL = (import.meta.env.VITE_DATA_URL as string | undefined) ?? '/data'
/** Panel width + margins, so framing centres the tree in the free space. */
const PANEL_INSET = 312
/** Signposts are framed at this many times their own width, to show relatives. */
const SIGNPOST_CONTEXT = 30

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const mql = window.matchMedia(query)
    const onChange = () => setMatches(mql.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])
  return matches
}

export default function App() {
  const [manifest, setManifest] = useState<Manifest | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [panelOpen, setPanelOpen] = useState(true)
  const tree = useRef<TreeViewHandle>(null)
  const wide = useMediaQuery('(min-width: 601px)')

  useEffect(() => {
    fetch(`${DATA_URL}/manifest.json`, { cache: 'no-cache' })
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
        return res.json() as Promise<Manifest>
      })
      .then(setManifest)
      .catch((err: unknown) => setError(String(err)))
  }, [])

  if (error) {
    return (
      <div className="status">
        <p>Couldn’t load the tree data ({error}).</p>
        <p className="hint">
          Run <code>uv run taxonomy-pipeline tiles</code> in <code>pipeline/</code> to generate it.
        </p>
      </div>
    )
  }
  if (!manifest) return <div className="status">Loading the tree of life…</div>

  const signposts = [...manifest.signposts].sort((a, b) => a.common.localeCompare(b.common))

  return (
    <main className="app">
      <TreeView
        ref={tree}
        manifest={manifest}
        dataUrl={DATA_URL}
        insetLeft={panelOpen && wide ? PANEL_INSET : 0}
      />

      <aside className={panelOpen ? 'panel' : 'panel closed'}>
        <header className="panel-header">
          <h1>Tree of Life</h1>
          <button
            className="icon-button"
            onClick={() => setPanelOpen(!panelOpen)}
            aria-expanded={panelOpen}
            aria-label={panelOpen ? 'Hide panel' : 'Show panel'}
          >
            {panelOpen ? '−' : '+'}
          </button>
        </header>

        {panelOpen && (
          <>
            <p className="lede">
              {manifest.nodeCount.toLocaleString()} branches, from the origin of life at the
              centre to every known species on the rim. Scroll or pinch to zoom, drag to move,
              click a branch to frame it.
            </p>

            <button className="home-button" onClick={() => tree.current?.home()}>
              Show the whole tree
            </button>

            <h2>Jump to</h2>
            <ul className="signposts">
              {signposts.map((s) => (
                <li key={s.node}>
                  <button
                    onClick={() =>
                      tree.current?.flyTo({ a0: s.a0, span: s.span, r: 1 - s.d }, SIGNPOST_CONTEXT)
                    }
                  >
                    <span>{s.common}</span>
                    <em>{s.name}</em>
                  </button>
                </li>
              ))}
            </ul>

            <h2>Groups</h2>
            <ul className="legend">
              {manifest.groups.map((g) => (
                <li key={g.g}>
                  <span
                    className="swatch"
                    style={{ background: `rgb(${g.colour.join(',')})` }}
                    aria-hidden
                  />
                  {g.label}
                </li>
              ))}
            </ul>

            <footer>
              Data: <a href="https://tree.opentreeoflife.org/">Open Tree of Life</a> synthesis{' '}
              {manifest.source.opentree.replace('opentree', 'v')}, taxonomy{' '}
              {manifest.source.ott.replace('ott', 'OTT ')}. Distance from the centre shows
              branching order, not time.
            </footer>
          </>
        )}
      </aside>
    </main>
  )
}
