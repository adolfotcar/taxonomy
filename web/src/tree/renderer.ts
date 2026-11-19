/**
 * Canvas 2D renderer. Every frame it picks the tiles in view, draws the
 * branches that are wide enough to matter, collapses thinner subtrees into a
 * faint wedge, and places as many labels as fit without overlapping.
 */

import {
  TAU,
  clamp,
  clipToRange,
  levelFor,
  overlaps,
  polar,
  tileIndexes,
  toAngle,
  turnsOf,
  visibleRange,
  type Camera,
  type Viewport,
  type VisibleRange,
} from './geometry'
import type { TileStore } from './tileStore'
import type { Manifest, Tile } from './types'

/** Subtrees narrower than this (px at the rim) are drawn as a fan, not branches. */
const WEDGE_PX = 2.5
const BACKGROUND = '#0b0d13'
const NO_GROUP: [number, number, number] = [120, 120, 120]
const LINE_WIDTHS = [0.9, 1.5, 2.4]
const MAX_LABELS = 260
const FONT_FAMILY = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'

export interface DrawnNode {
  tile: Tile
  i: number
}

export interface Frame {
  range: VisibleRange
  level: number
  drawn: DrawnNode[]
}

export interface RenderInput {
  ctx: CanvasRenderingContext2D
  cam: Camera
  vp: Viewport
  manifest: Manifest
  store: TileStore
  hover: DrawnNode | null
}

export function render({ ctx, cam, vp, manifest, store, hover }: RenderInput): Frame {
  const range = visibleRange(cam, vp)
  const level = levelFor(cam, range, manifest.tileDetail, store.maxLevel)
  const colours = groupColours(manifest)
  const hw = vp.width / 2
  const hh = vp.height / 2
  const pxPerTurnRim = TAU * cam.scale
  const angPad = range.full ? 0 : (range.end - range.start) * 0.05
  const radPad = (range.rmax - range.rmin) * 0.05 + 4 / cam.scale
  const rLo = range.rmin - radPad
  const rHi = range.rmax + radPad

  const sx = (wx: number) => hw + (wx - cam.x) * cam.scale
  const sy = (wy: number) => hh + (wy - cam.y) * cam.scale
  const moveTo = (p: Path2D, t: number, r: number) => {
    const [x, y] = polar(t, r)
    p.moveTo(sx(x), sy(y))
  }
  const lineTo = (p: Path2D, t: number, r: number) => {
    const [x, y] = polar(t, r)
    p.lineTo(sx(x), sy(y))
  }
  /** Arc as line segments, computed in float64 (canvas arcs lose precision at huge radii). */
  const arcTo = (p: Path2D, t0: number, t1: number, r: number, move: boolean) => {
    const segs = clamp(Math.ceil((Math.abs(t1 - t0) * TAU * r * cam.scale) / 6), 1, 512)
    for (let k = 0; k <= segs; k++) {
      const t = t0 + ((t1 - t0) * k) / segs
      if (k === 0 && move) moveTo(p, t, r)
      else lineTo(p, t, r)
    }
  }

  /**
   * A fan: the triangle from (mid, r) to the slice [mid - span/2, mid + span/2] at
   * the rim, clipped to the visible radii. Its half-width grows linearly with radius.
   */
  const addFan = (p: Path2D, mid: number, span: number, r: number) => {
    const f0 = Math.max(r, rLo)
    const f1 = Math.min(1, rHi)
    if (f1 <= f0 || r >= 1) return
    const half = (rho: number) => (span / 2) * ((rho - r) / (1 - r))
    const h0 = half(f0)
    const h1 = half(f1)
    for (const [t0, t1] of clipToRange(mid - h1, mid + h1, range, angPad)) {
      // Matching inner edge, clipped the same way.
      const i0 = clamp(t0, mid - h0, mid + h0)
      const i1 = clamp(t1, mid - h0, mid + h0)
      arcTo(p, t0, t1, f1, true)
      if (i1 > i0) arcTo(p, i1, i0, f0, false)
      else lineTo(p, i0, f0)
      p.closePath()
    }
  }

  ctx.fillStyle = BACKGROUND
  ctx.fillRect(0, 0, vp.width, vp.height)

  // 1. Pick the nodes to draw.
  const drawn: DrawnNode[] = []
  if (range.rmin <= 1 + radPad) {
    for (let L = 0; L <= level; L++) {
      for (const index of tileIndexes(L, range)) {
        const tile = store.get(L, index)
        if (!tile) continue
        for (let i = 0; i < tile.n; i++) {
          const a0 = tile.a0[i]
          const span = tile.span[i]
          if (!overlaps(a0, a0 + span, range, angPad)) continue
          if (tile.pr[i] > rHi) continue
          if (tile.id[i] !== 0 && tile.ps[i] * pxPerTurnRim < WEDGE_PX) continue // parent is a wedge
          const isWedge = tile.tips[i] > 1 && span * pxPerTurnRim < WEDGE_PX
          if (tile.r[i] < rLo && !isWedge) continue // whole branch is inside the view's inner edge
          drawn.push({ tile, i })
        }
      }
    }
  }

  // 2. Build one path per colour group and line width, plus wedge fills.
  const strokes = new Map<string, Path2D>()
  const wedges = new Map<number, Path2D>()
  for (const { tile, i } of drawn) {
    if (tile.id[i] === 0) continue
    const a0 = tile.a0[i]
    const span = tile.span[i]
    const mid = a0 + span / 2
    const r = tile.r[i]
    const pr = tile.pr[i]
    const tips = tile.tips[i]
    const g = tile.g[i]
    const wc = tips >= 10000 ? 2 : tips >= 100 ? 1 : 0
    const key = `${g}:${wc}`
    let path = strokes.get(key)
    if (!path) strokes.set(key, (path = new Path2D()))

    // Radial segment from the parent's radius to this node.
    const r0 = Math.max(pr, rLo)
    const r1 = Math.min(r, rHi)
    if (r1 > r0) {
      moveTo(path, mid, r0)
      lineTo(path, mid, r1)
    }
    // Arc along the parent's radius, joining this branch to the parent's mid-angle.
    if (pr >= rLo && pr <= rHi && Math.abs(tile.pm[i] - mid) > 0) {
      const lo = Math.min(mid, tile.pm[i])
      const hi = Math.max(mid, tile.pm[i])
      for (const [t0, t1] of clipToRange(lo, hi, range, angPad)) arcTo(path, t0, t1, pr, true)
    }
    // Collapsed subtree: a fan from this node's point out to its slice at the rim.
    if (tips > 1 && span * pxPerTurnRim < WEDGE_PX) {
      let w = wedges.get(g)
      if (!w) wedges.set(g, (w = new Path2D()))
      addFan(w, mid, span, r)
    }
  }

  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const [g, path] of wedges) {
    ctx.fillStyle = rgba(colours[g] ?? NO_GROUP, 0.55)
    ctx.fill(path)
  }
  for (const [key, path] of strokes) {
    const [g, wc] = key.split(':').map(Number)
    ctx.strokeStyle = rgba(colours[g] ?? NO_GROUP, 0.9)
    ctx.lineWidth = LINE_WIDTHS[wc]
    ctx.stroke(path)
  }

  // 3. Hover highlight: the hovered node's whole slice.
  if (hover) {
    const { tile, i } = hover
    const a0 = tile.a0[i]
    const span = tile.span[i]
    const p = new Path2D()
    const w0 = Math.max(tile.r[i], rLo)
    const w1 = Math.min(1, rHi)
    if (w1 > w0) {
      for (const [t0, t1] of clipToRange(a0, a0 + span, range, angPad)) {
        arcTo(p, t0, t1, w1, true)
        arcTo(p, t1, t0, w0, false)
        p.closePath()
      }
    }
    ctx.fillStyle = 'rgba(255,255,255,0.10)'
    ctx.fill(p)
    const b = new Path2D()
    const mid = a0 + span / 2
    moveTo(b, mid, Math.max(tile.pr[i], rLo))
    lineTo(b, mid, Math.min(tile.r[i], rHi))
    ctx.strokeStyle = 'rgba(255,255,255,0.95)'
    ctx.lineWidth = 2.5
    ctx.stroke(b)
  }

  // 4. Labels.
  drawLabels(ctx, cam, vp, manifest, range, drawn, colours, { sx, sy })

  return { range, level, drawn }
}

/** The drawn node under a world point: the branch at that radius, else the deepest slice. */
export function hitTest(frame: Frame, wx: number, wy: number, cam: Camera): DrawnNode | null {
  const rho = Math.hypot(wx, wy)
  if (rho > 1 + 12 / cam.scale) return null
  const t = turnsOf(wx, wy)
  let best: DrawnNode | null = null
  let bestR = -1
  for (const d of frame.drawn) {
    const { tile, i } = d
    const a0 = tile.a0[i]
    if (t < a0 || t >= a0 + tile.span[i]) continue
    const r = tile.r[i]
    if (tile.pr[i] <= rho && rho <= r) return d
    if (r <= rho && r > bestR) {
      best = d
      bestR = r
    }
  }
  return best
}

// ---------------------------------------------------------------------------

interface Label {
  text: string
  font: string
  colour: string
  priority: number
  /** Screen anchor and baseline direction. */
  x: number
  y: number
  angle: number
  align: 'left' | 'right' | 'center'
  size: number
  /** Skip the label if its text is wider than this (px). */
  maxWidth?: number
  dot?: boolean
  dotX?: number
  dotY?: number
}

const widthCache = new Map<string, number>()
function measure(ctx: CanvasRenderingContext2D, font: string, text: string): number {
  const key = `${font}|${text}`
  let w = widthCache.get(key)
  if (w === undefined) {
    ctx.font = font
    w = ctx.measureText(text).width
    if (widthCache.size > 20000) widthCache.clear()
    widthCache.set(key, w)
  }
  return w
}

function drawLabels(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  vp: Viewport,
  manifest: Manifest,
  range: VisibleRange,
  drawn: DrawnNode[],
  colours: Record<number, [number, number, number]>,
  { sx, sy }: { sx: (x: number) => number; sy: (y: number) => number },
) {
  const pxPerTurnRim = TAU * cam.scale
  const groupByNode = new Map(manifest.groups.filter((g) => g.node !== null).map((g) => [g.node, g]))
  const signpostNodes = new Set(manifest.signposts.map((s) => s.node))
  const candidates: Label[] = []

  const radial = (mid: number, text: string, font: string, size: number, colour: string, priority: number, dot = false) => {
    const theta = toAngle(mid)
    const [rx, ry] = polar(mid, 1)
    const px = sx(rx)
    const py = sy(ry)
    const left = Math.cos(theta) < 0
    const off = dot ? 9 : 5
    candidates.push({
      text,
      font,
      size,
      colour,
      priority,
      x: px + Math.cos(theta) * off,
      y: py + Math.sin(theta) * off,
      angle: left ? theta + Math.PI : theta,
      align: left ? 'right' : 'left',
      dot,
      dotX: px,
      dotY: py,
    })
  }
  const tangential = (
    mid: number,
    r: number,
    text: string,
    font: string,
    size: number,
    colour: string,
    priority: number,
    maxWidth: number,
  ) => {
    const theta = toAngle(mid)
    const [x, y] = polar(mid, r)
    let angle = theta + Math.PI / 2
    if (Math.cos(angle) < 0) angle += Math.PI
    const off = size * 0.9
    candidates.push({
      text,
      font,
      size,
      colour,
      priority,
      x: sx(x) + Math.cos(theta) * off,
      y: sy(y) + Math.sin(theta) * off,
      angle,
      align: 'center',
      maxWidth,
    })
  }

  for (const s of manifest.signposts) {
    if (!overlaps(s.a0, s.a0 + s.span, range) || range.rmin > 1 || range.rmax < 1) continue
    radial(s.a0 + s.span / 2, s.common, `600 13px ${FONT_FAMILY}`, 13, '#f2f2f2', 1e15, true)
  }

  for (const { tile, i } of drawn) {
    const name = tile.name[i]
    const id = tile.id[i]
    const span = tile.span[i]
    const mid = tile.a0[i] + span / 2
    const r = tile.r[i]
    const group = groupByNode.get(id)
    if (group) {
      // Place the name at the smallest radius where it fits inside the group's slice.
      const font = `700 17px ${FONT_FAMILY}`
      const needed = measure(ctx, font, group.label) + 24
      const arcPerRadius = span * TAU * cam.scale
      const rl = Math.max(r + 0.03, needed / arcPerRadius)
      if (rl < 0.97) {
        tangential(mid, rl, group.label, font, 17, rgba(group.colour, 1), 1e14, Infinity)
      }
      continue
    }
    if (!name || signpostNodes.has(id)) continue
    if (tile.tips[i] === 1) {
      const width = span * pxPerTurnRim
      if (width >= 10 && range.rmin <= 1 && range.rmax >= 1) {
        radial(mid, name, `italic 12px ${FONT_FAMILY}`, 12, '#d9dce4', width)
      }
    } else {
      const arc = span * TAU * r * cam.scale
      if (arc >= 50) {
        const g = tile.g[i]
        const c = colours[g] ?? NO_GROUP
        tangential(
          mid,
          r,
          name,
          `500 12px ${FONT_FAMILY}`,
          12,
          rgba(lighten(c), 1),
          arc + tile.tips[i],
          arc - 8,
        )
      }
    }
  }

  candidates.sort((a, b) => b.priority - a.priority)
  const grid = new CollisionGrid(24)
  let placed = 0
  ctx.textBaseline = 'middle'
  for (const label of candidates) {
    if (placed >= MAX_LABELS) break
    const w = measure(ctx, label.font, label.text)
    if (label.maxWidth !== undefined && w > label.maxWidth) continue
    const circles = labelCircles(label, w)
    if (!circles.some(([x, y]) => x > -20 && x < vp.width + 20 && y > -20 && y < vp.height + 20)) continue
    if (grid.hits(circles)) continue
    grid.add(circles)
    placed++

    if (label.dot && label.dotX !== undefined && label.dotY !== undefined) {
      ctx.beginPath()
      ctx.arc(label.dotX, label.dotY, 4, 0, TAU)
      ctx.fillStyle = '#ffffff'
      ctx.fill()
      ctx.lineWidth = 2
      ctx.strokeStyle = BACKGROUND
      ctx.stroke()
    }
    ctx.save()
    ctx.translate(label.x, label.y)
    ctx.rotate(label.angle)
    ctx.font = label.font
    ctx.textAlign = label.align
    ctx.lineWidth = 3.5
    ctx.strokeStyle = 'rgba(11,13,19,0.9)'
    ctx.strokeText(label.text, 0, 0)
    ctx.fillStyle = label.colour
    ctx.fillText(label.text, 0, 0)
    ctx.restore()
  }
}

/** Approximate a rotated text box by circles along its baseline. */
function labelCircles(label: Label, width: number): [number, number, number][] {
  const r = label.size * 0.55
  const dx = Math.cos(label.angle)
  const dy = Math.sin(label.angle)
  const start = label.align === 'left' ? 0 : label.align === 'right' ? -width : -width / 2
  const n = Math.max(1, Math.ceil(width / r))
  const out: [number, number, number][] = []
  for (let k = 0; k <= n; k++) {
    const s = start + (width * k) / n
    out.push([label.x + dx * s, label.y + dy * s, r])
  }
  return out
}

class CollisionGrid {
  private readonly cell: number
  private readonly cells = new Map<string, [number, number, number][]>()
  constructor(cell: number) {
    this.cell = cell
  }
  private key(x: number, y: number) {
    return `${Math.floor(x / this.cell)},${Math.floor(y / this.cell)}`
  }
  hits(circles: [number, number, number][]): boolean {
    for (const [x, y, r] of circles) {
      const cx = Math.floor(x / this.cell)
      const cy = Math.floor(y / this.cell)
      for (let i = cx - 1; i <= cx + 1; i++) {
        for (let j = cy - 1; j <= cy + 1; j++) {
          for (const [ox, oy, or] of this.cells.get(`${i},${j}`) ?? []) {
            if (Math.hypot(ox - x, oy - y) < or + r) return true
          }
        }
      }
    }
    return false
  }
  add(circles: [number, number, number][]) {
    for (const c of circles) {
      const k = this.key(c[0], c[1])
      const list = this.cells.get(k)
      if (list) list.push(c)
      else this.cells.set(k, [c])
    }
  }
}

function groupColours(manifest: Manifest): Record<number, [number, number, number]> {
  return Object.fromEntries(manifest.groups.map((g) => [g.g, g.colour]))
}

function rgba([r, g, b]: [number, number, number], a: number) {
  return `rgba(${r},${g},${b},${a})`
}

function lighten([r, g, b]: [number, number, number]): [number, number, number] {
  return [r + (255 - r) * 0.55, g + (255 - g) * 0.55, b + (255 - b) * 0.55]
}
