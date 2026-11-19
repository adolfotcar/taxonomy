import type { Manifest, Tile, TileJson } from './types'

const MAX_CONCURRENT = 8
const MAX_CACHED = 400
const PINNED_LEVELS = 3 // levels 0..2 are small and always kept

/** Loads tiles on demand, caches them (LRU) and calls `onLoad` when one arrives. */
export class TileStore {
  private readonly cache = new Map<string, Tile>()
  private readonly loading = new Set<string>()
  private readonly failed = new Set<string>()
  private readonly available: Map<number, Set<number>>
  private readonly baseUrl: string
  private readonly manifest: Manifest
  private readonly onLoad: () => void
  readonly maxLevel: number

  constructor(baseUrl: string, manifest: Manifest, onLoad: () => void) {
    this.baseUrl = baseUrl
    this.manifest = manifest
    this.onLoad = onLoad
    this.available = new Map(
      Object.entries(manifest.tiles).map(([level, idx]) => [Number(level), new Set(idx)]),
    )
    this.maxLevel = Math.max(...this.available.keys())
  }

  /** The tile if loaded; otherwise starts loading it (if it exists) and returns undefined. */
  get(level: number, index: number): Tile | undefined {
    const key = `${level}/${index}`
    const tile = this.cache.get(key)
    if (tile) {
      this.cache.delete(key) // refresh LRU position
      this.cache.set(key, tile)
      return tile
    }
    if (
      this.available.get(level)?.has(index) &&
      !this.loading.has(key) &&
      !this.failed.has(key) &&
      this.loading.size < MAX_CONCURRENT
    ) {
      void this.load(level, index, key)
    }
    return undefined
  }

  get pending(): number {
    return this.loading.size
  }

  private async load(level: number, index: number, key: string) {
    this.loading.add(key)
    try {
      const path = this.manifest.tilePath
        .replace('{level}', String(level))
        .replace('{index}', String(index))
      const res = await fetch(`${this.baseUrl}/${path}`)
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
      this.cache.set(key, toTile(level, index, (await res.json()) as TileJson))
      this.evict()
    } catch (err) {
      console.warn(`tile ${key} failed to load`, err)
      this.failed.add(key)
    } finally {
      this.loading.delete(key)
      this.onLoad()
    }
  }

  private evict() {
    for (const [key, tile] of this.cache) {
      if (this.cache.size <= MAX_CACHED) break
      if (tile.level >= PINNED_LEVELS) this.cache.delete(key)
    }
  }
}

export function toTile(level: number, index: number, t: TileJson): Tile {
  return {
    level,
    index,
    n: t.id.length,
    id: Int32Array.from(t.id),
    a0: Float64Array.from(t.a0),
    span: Float64Array.from(t.span),
    r: Float64Array.from(t.d, (d) => 1 - d),
    pr: Float64Array.from(t.pd, (d) => 1 - d),
    pm: Float64Array.from(t.pm),
    ps: Float64Array.from(t.ps),
    tips: Int32Array.from(t.tips),
    g: Uint8Array.from(t.g),
    name: t.name,
  }
}
