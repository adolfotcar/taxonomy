import { describe, expect, it } from 'vitest'
import {
  clipToRange,
  fitCamera,
  homeCamera,
  levelFor,
  overlaps,
  polar,
  tileIndexes,
  toScreen,
  toWorld,
  turnsOf,
  visibleRange,
  zoomAt,
  type VisibleRange,
} from './geometry'

const vp = { width: 1000, height: 800 }

describe('polar / turnsOf', () => {
  it('puts 0 turns at 12 o’clock and goes clockwise', () => {
    const [x0, y0] = polar(0, 1)
    expect(x0).toBeCloseTo(0)
    expect(y0).toBeCloseTo(-1)
    const [x1, y1] = polar(0.25, 1)
    expect(x1).toBeCloseTo(1)
    expect(y1).toBeCloseTo(0)
  })

  it('round-trips', () => {
    for (const t of [0, 0.1, 0.25, 0.5, 0.75, 0.999]) {
      const [x, y] = polar(t, 0.7)
      expect(turnsOf(x, y)).toBeCloseTo(t, 12)
    }
  })

  it('keeps precision for tiny slices near the rim', () => {
    const t = 0.123456789
    const dt = 2e-10
    const [xa, ya] = polar(t, 1)
    const [xb, yb] = polar(t + dt, 1)
    expect(turnsOf(xb, yb) - turnsOf(xa, ya)).toBeCloseTo(dt, 15)
  })
})

describe('camera', () => {
  it('converts screen ↔ world', () => {
    const cam = { x: 0.3, y: -0.2, scale: 1234 }
    const [wx, wy] = toWorld(cam, vp, 100, 700)
    const [sx, sy] = toScreen(cam, vp, wx, wy)
    expect(sx).toBeCloseTo(100)
    expect(sy).toBeCloseTo(700)
  })

  it('zooms around the cursor', () => {
    const cam = homeCamera(vp)
    const before = toWorld(cam, vp, 200, 300)
    const after = toWorld(zoomAt(cam, vp, 200, 300, 8), vp, 200, 300)
    expect(after[0]).toBeCloseTo(before[0], 12)
    expect(after[1]).toBeCloseTo(before[1], 12)
  })
})

describe('visibleRange', () => {
  it('is full when the origin is on screen', () => {
    const range = visibleRange(homeCamera(vp), vp)
    expect(range.full).toBe(true)
    expect(range.rmin).toBe(0)
  })

  it('gives a narrow arc when zoomed into the rim', () => {
    const [x, y] = polar(0.3, 1)
    const range = visibleRange({ x, y, scale: 1e6 }, vp)
    expect(range.full).toBe(false)
    expect(range.start).toBeLessThan(0.3)
    expect(range.end).toBeGreaterThan(0.3)
    expect(range.end - range.start).toBeLessThan(1e-3)
    expect(range.rmin).toBeLessThan(1)
    expect(range.rmax).toBeGreaterThan(1)
  })

  it('wraps across 12 o’clock', () => {
    const [x, y] = polar(0, 1)
    const range = visibleRange({ x, y, scale: 1e5 }, vp)
    expect(range.start).toBeGreaterThan(0.99)
    expect(range.end).toBeGreaterThan(1)
    expect(overlaps(0.0002, 0.0003, range)).toBe(true)
    expect(overlaps(0.9998, 0.9999, range)).toBe(true)
    expect(overlaps(0.5, 0.6, range)).toBe(false)
    expect(overlaps(0.002, 0.003, range)).toBe(false)
  })
})

describe('clipToRange', () => {
  const range: VisibleRange = { full: false, start: 0.95, end: 1.05, rmin: 0.9, rmax: 1.1 }

  it('returns the parts on both sides of the wrap', () => {
    expect(clipToRange(0, 1, range)).toEqual([
      [0, expect.closeTo(0.05, 12)],
      [0.95, 1],
    ])
  })

  it('returns nothing outside the range', () => {
    expect(clipToRange(0.4, 0.6, range)).toEqual([])
  })
})

describe('tiles', () => {
  it('loads only level 0 for the whole-tree view', () => {
    const cam = homeCamera(vp)
    expect(levelFor(cam, visibleRange(cam, vp), 4096, 21)).toBe(0)
  })

  it('loads deeper levels and only a couple of tiles per level when zoomed in', () => {
    const [x, y] = polar(0.3, 1)
    const cam = { x, y, scale: 1e7 }
    const range = visibleRange(cam, vp)
    const level = levelFor(cam, range, 4096, 21)
    expect(level).toBeGreaterThan(10)
    for (let L = 0; L <= level; L++) {
      const idx = tileIndexes(L, range)
      expect(idx.length).toBeGreaterThan(0)
      expect(idx.length).toBeLessThanOrEqual(3)
      for (const k of idx) expect(k / 2 ** L).toBeLessThanOrEqual(0.3 + 1 / 2 ** L)
    }
  })
})

describe('fitCamera', () => {
  it('frames a tip with context, just inside the rim, at a deep zoom', () => {
    const cam = fitCamera({ a0: 0.5, span: 1e-8, r: 1 }, vp, 30)
    expect(cam.scale).toBeGreaterThan(1e7)
    expect(Math.hypot(cam.x, cam.y)).toBeLessThan(1)
    expect(turnsOf(cam.x, cam.y)).toBeCloseTo(0.5, 6)
  })
})

describe('fitCamera for slivers', () => {
  it('zooms on the width of a thin slice and shows its outer end', () => {
    const node = { a0: 0.2, span: 0.005, r: 0.3 }
    const cam = fitCamera(node, vp)
    const range = visibleRange(cam, vp)
    expect(range.rmax).toBeGreaterThan(1) // rim on screen
    expect(range.rmin).toBeGreaterThan(0.3) // not wasting the view on the long stem
    expect(range.end - range.start).toBeGreaterThan(0.005)
    expect(range.end - range.start).toBeLessThan(0.02)
  })

  it('centres in the space right of a panel', () => {
    const cam = homeCamera(vp, 300)
    const [sx] = toScreen(cam, vp, 0, 0)
    expect(sx).toBeCloseTo(300 + (vp.width - 300) / 2)
  })
})
