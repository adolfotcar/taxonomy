/** Shapes of the static data produced by `taxonomy-pipeline tiles`. */

export interface GroupInfo {
  g: number
  label: string
  taxon: string
  colour: [number, number, number]
  node: number | null
}

export interface Signpost {
  name: string
  common: string
  node: number
  a0: number
  span: number
  /** Gap to the rim (1 - radius). */
  d: number
}

export interface Manifest {
  version: string
  generated: string
  source: { opentree: string; ott: string }
  compression: number
  fractal: number
  tileDetail: number
  tilePath: string
  tiles: Record<string, number[]>
  nodeCount: number
  groups: GroupInfo[]
  signposts: Signpost[]
}

/** Raw JSON of one tile: parallel arrays, one entry per node. */
export interface TileJson {
  id: number[]
  a0: number[]
  span: number[]
  /** Gap to the rim, 1 - radius (kept separately for precision near the rim). */
  d: number[]
  pd: number[]
  pm: number[]
  ps: number[]
  tips: number[]
  g: number[]
  name: (string | null)[]
}

/** A loaded tile, numbers in typed arrays. */
export interface Tile {
  level: number
  index: number
  n: number
  id: Int32Array
  a0: Float64Array
  span: Float64Array
  r: Float64Array
  pr: Float64Array
  pm: Float64Array
  ps: Float64Array
  tips: Int32Array
  g: Uint8Array
  name: (string | null)[]
}

/** The geometry needed to place or fly to a node. */
export interface NodeGeom {
  a0: number
  span: number
  r: number
}
