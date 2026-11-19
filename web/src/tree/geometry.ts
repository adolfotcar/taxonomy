/**
 * Pure geometry for the radial tree.
 *
 * World space: the tree is a unit circle centred on the origin. Angles are in
 * *turns* (0..1), 0 at 12 o'clock, increasing clockwise (screen y points down).
 * All maths is done in float64 on the CPU, which keeps single species placeable
 * at zoom factors of 10^10 and more.
 */

import type { NodeGeom } from './types'

export const TAU = Math.PI * 2

export interface Camera {
  /** World point at the centre of the screen. */
  x: number
  y: number
  /** Screen pixels per world unit. */
  scale: number
}

export interface Viewport {
  width: number
  height: number
}

/** Angular and radial extent of what the screen shows. */
export interface VisibleRange {
  /** The origin is on screen, so every angle is visible. */
  full: boolean
  /** Visible angles are [start, end) in turns; end may exceed 1 (wraps). */
  start: number
  end: number
  rmin: number
  rmax: number
}

export const MIN_SCALE_FACTOR = 0.15 // of min(width, height) per world unit
export const MAX_SCALE = 1e14

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export const toAngle = (turns: number) => turns * TAU - Math.PI / 2

export function polar(turns: number, r: number): [number, number] {
  const a = toAngle(turns)
  return [r * Math.cos(a), r * Math.sin(a)]
}

export function turnsOf(x: number, y: number): number {
  const t = (Math.atan2(y, x) + Math.PI / 2) / TAU
  return t - Math.floor(t)
}

export function toScreen(cam: Camera, vp: Viewport, x: number, y: number): [number, number] {
  return [vp.width / 2 + (x - cam.x) * cam.scale, vp.height / 2 + (y - cam.y) * cam.scale]
}

export function toWorld(cam: Camera, vp: Viewport, sx: number, sy: number): [number, number] {
  return [cam.x + (sx - vp.width / 2) / cam.scale, cam.y + (sy - vp.height / 2) / cam.scale]
}

export function minScale(vp: Viewport): number {
  return Math.min(vp.width, vp.height) * MIN_SCALE_FACTOR
}

/**
 * Shift a camera so its target appears centred in the part of the screen not
 * covered by a left-hand panel `inset` px wide.
 */
export function withInset(cam: Camera, inset: number): Camera {
  return { ...cam, x: cam.x - inset / 2 / cam.scale }
}

/** Camera showing the whole circle with a margin for rim labels. */
export function homeCamera(vp: Viewport, inset = 0): Camera {
  const free = Math.min(vp.width - inset, vp.height)
  return withInset({ x: 0, y: 0, scale: (free / 2) * 0.72 }, inset)
}

/** Zoom by `factor` keeping the world point under screen point (sx, sy) fixed. */
export function zoomAt(cam: Camera, vp: Viewport, sx: number, sy: number, factor: number): Camera {
  const [wx, wy] = toWorld(cam, vp, sx, sy)
  const scale = clamp(cam.scale * factor, minScale(vp), MAX_SCALE)
  return {
    x: wx - (sx - vp.width / 2) / scale,
    y: wy - (sy - vp.height / 2) / scale,
    scale,
  }
}

export function visibleRange(cam: Camera, vp: Viewport): VisibleRange {
  const hw = vp.width / 2 / cam.scale
  const hh = vp.height / 2 / cam.scale
  const x0 = cam.x - hw
  const x1 = cam.x + hw
  const y0 = cam.y - hh
  const y1 = cam.y + hh
  const corners: [number, number][] = [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ]
  const rmax = Math.max(...corners.map(([x, y]) => Math.hypot(x, y)))
  const rmin = Math.hypot(clamp(0, x0, x1), clamp(0, y0, y1))
  if (rmin === 0) return { full: true, start: 0, end: 1, rmin, rmax }

  // The view is convex and excludes the origin, so its angular extent is the
  // shortest arc containing the four corners: the complement of the largest gap.
  const ts = corners.map(([x, y]) => turnsOf(x, y)).sort((a, b) => a - b)
  let gapAt = 0
  let gap = -1
  for (let i = 0; i < 4; i++) {
    const next = i === 3 ? ts[0] + 1 : ts[i + 1]
    if (next - ts[i] > gap) {
      gap = next - ts[i]
      gapAt = i
    }
  }
  const start = ts[(gapAt + 1) % 4]
  let end = ts[gapAt]
  if (end < start) end += 1
  return { full: false, start, end, rmin, rmax }
}

/** Does the angular interval [a0, a1] (within 0..1) intersect the range? */
export function overlaps(a0: number, a1: number, range: VisibleRange, pad = 0): boolean {
  if (range.full) return true
  const s = range.start - pad
  const e = range.end + pad
  return (a1 > s && a0 < e) || (a1 + 1 > s && a0 + 1 < e) || (a1 - 1 > s && a0 - 1 < e)
}

/** Parts of [lo, hi] (turns, within 0..1) that fall inside the range. */
export function clipToRange(
  lo: number,
  hi: number,
  range: VisibleRange,
  pad = 0,
): [number, number][] {
  if (range.full || range.end - range.start + 2 * pad >= 1) return [[lo, hi]]
  const out: [number, number][] = []
  for (const k of [-1, 0, 1]) {
    const a = Math.max(lo, range.start - pad + k)
    const b = Math.min(hi, range.end + pad + k)
    if (b > a) out.push([a, b])
  }
  return out
}

/**
 * Deepest tile level worth loading. Level L holds nodes whose span is in
 * [2^-L, 2^-(L-1)) / tileDetail turns; load it while its biggest nodes would be
 * at least ~1 px wide at the outermost visible radius.
 */
export function levelFor(cam: Camera, range: VisibleRange, tileDetail: number, maxLevel: number) {
  const pxPerTurn = TAU * Math.min(range.rmax, 1) * cam.scale
  const level = Math.floor(1 + Math.log2(pxPerTurn / tileDetail))
  return clamp(Number.isFinite(level) ? level : 0, 0, maxLevel)
}

/** Tile indexes of `level` that intersect the range (capped for safety). */
export function tileIndexes(level: number, range: VisibleRange, cap = 256): number[] {
  const n = 2 ** level
  if (range.full || range.end - range.start >= 1) {
    return n <= cap ? Array.from({ length: n }, (_, i) => i) : []
  }
  const pad = 1 / n / 64
  const i0 = Math.floor((range.start - pad) * n)
  const i1 = Math.floor((range.end + pad) * n)
  const out = new Set<number>()
  for (let i = i0; i <= i1 && out.size < cap; i++) out.add(((i % n) + n) % n)
  return [...out]
}

/**
 * Camera that frames a node's slice. The zoom is set by the slice's width at the
 * rim (times `context`, to show neighbours too); the view is centred on the
 * node's subtree, or, for a long thin sliver, on its outer end where the
 * branching is, with the rim kept a little inside the screen for rim labels.
 */
export function fitCamera(node: NodeGeom, vp: Viewport, context = 1, inset = 0): Camera {
  const mid = node.a0 + node.span / 2
  const free = { width: vp.width - inset, height: vp.height }
  const arc = Math.max(node.span * TAU * context, 1e-15)
  const scale = clamp((Math.min(free.width, free.height) * 0.75) / arc, minScale(vp), MAX_SCALE)
  // The radial direction may point any way on screen, so use the smaller half-extent.
  const halfExtent = Math.min(free.width, free.height) / 2 / scale
  const rimInside = 1 - halfExtent + 110 / scale // rim ~110 px inside the screen edge
  // Small subtrees near the rim: keep the rim a bit off-centre, leaving room for labels.
  const rimOffCentre = 1 - halfExtent * 0.35
  const r = clamp((node.r + 1) / 2, rimInside, Math.max(rimInside, rimOffCentre))
  const [x, y] = polar(mid, r)
  return withInset({ x, y, scale }, inset)
}
