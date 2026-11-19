import { interpolateZoom } from 'd3-interpolate'
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react'
import {
  MAX_SCALE,
  clamp,
  fitCamera,
  homeCamera,
  minScale,
  toWorld,
  zoomAt,
  type Camera,
  type Viewport,
} from './geometry'
import { hitTest, render, type DrawnNode, type Frame } from './renderer'
import { TileStore } from './tileStore'
import type { Manifest, NodeGeom } from './types'

export interface TreeViewHandle {
  /** Fly to a node; `context` > 1 zooms out that many times its width to show neighbours. */
  flyTo(node: NodeGeom, context?: number): void
  home(): void
}

export interface HoverInfo {
  name: string | null
  tips: number
  group: string | null
  x: number
  y: number
}

interface Props {
  manifest: Manifest
  dataUrl: string
  /** Width (px) of UI covering the left of the canvas; framing centres in the rest. */
  insetLeft?: number
  ref?: Ref<TreeViewHandle>
}

export function TreeView({ manifest, dataUrl, insetLeft = 0, ref }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [hover, setHover] = useState<HoverInfo | null>(null)
  const api = useRef<TreeViewHandle>({ flyTo: () => {}, home: () => {} })
  const inset = useRef(insetLeft)
  useEffect(() => {
    inset.current = insetLeft
  }, [insetLeft])

  useImperativeHandle(ref, () => ({
    flyTo: (node, context) => api.current.flyTo(node, context),
    home: () => api.current.home(),
  }))

  useEffect(() => {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d', { alpha: false })!
    let vp: Viewport = { width: 1, height: 1 }
    let cam: Camera | null = readHash()
    let frame: Frame | null = null
    let hovered: DrawnNode | null = null
    let dirty = true
    let raf = 0
    let animation: number | null = null
    const store = new TileStore(dataUrl, manifest, () => invalidate())

    const groupLabel = new Map(manifest.groups.map((g) => [g.g, g.label]))

    function invalidate() {
      dirty = true
      if (!raf) raf = requestAnimationFrame(draw)
    }

    function draw() {
      raf = 0
      if (!dirty || !cam) return
      dirty = false
      const dpr = window.devicePixelRatio || 1
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      frame = render({ ctx, cam, vp, manifest, store, hover: hovered })
      writeHash(cam)
    }

    function setCamera(next: Camera) {
      cam = { ...next, scale: clamp(next.scale, minScale(vp), MAX_SCALE) }
      invalidate()
    }

    function stopAnimation() {
      if (animation !== null) cancelAnimationFrame(animation)
      animation = null
    }

    function flyTo(target: Camera) {
      if (!cam) return setCamera(target)
      stopAnimation()
      const from = cam
      const interp = interpolateZoom(
        [from.x, from.y, vp.width / from.scale],
        [target.x, target.y, vp.width / target.scale],
      )
      const duration = clamp(interp.duration * 0.7, 500, 3500)
      const t0 = performance.now()
      const step = (now: number) => {
        const t = clamp((now - t0) / duration, 0, 1)
        const e = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2 // easeInOutCubic
        const [x, y, w] = interp(e)
        setCamera({ x, y, scale: vp.width / w })
        animation = t < 1 ? requestAnimationFrame(step) : null
      }
      animation = requestAnimationFrame(step)
    }

    api.current = {
      flyTo: (node, context = 1) => flyTo(fitCamera(node, vp, context, inset.current)),
      home: () => flyTo(homeCamera(vp, inset.current)),
    }

    // --- sizing -----------------------------------------------------------
    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      vp = { width: rect.width, height: rect.height }
      canvas.width = Math.round(rect.width * dpr)
      canvas.height = Math.round(rect.height * dpr)
      if (!cam) cam = homeCamera(vp, inset.current)
      dirty = true
      draw()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)

    // --- interaction ------------------------------------------------------
    const pointers = new Map<number, { x: number; y: number }>()
    let dragDistance = 0
    let pinchDist = 0

    const local = (e: { clientX: number; clientY: number }) => {
      const rect = canvas.getBoundingClientRect()
      return { x: e.clientX - rect.left, y: e.clientY - rect.top }
    }

    const updateHover = (x: number, y: number) => {
      if (!frame || !cam) return
      const [wx, wy] = toWorld(cam, vp, x, y)
      const hit = hitTest(frame, wx, wy, cam)
      const same = hit && hovered && hit.tile === hovered.tile && hit.i === hovered.i
      if (!same) {
        hovered = hit
        invalidate()
      }
      setHover(
        hit
          ? {
              name: hit.tile.name[hit.i],
              tips: hit.tile.tips[hit.i],
              group: groupLabel.get(hit.tile.g[hit.i]) ?? null,
              x,
              y,
            }
          : null,
      )
    }

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      if (!cam) return
      stopAnimation()
      const { x, y } = local(e)
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY
      setCamera(zoomAt(cam, vp, x, y, Math.exp(-delta * 0.0018)))
      updateHover(x, y)
    }

    const onPointerDown = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId)
      stopAnimation()
      pointers.set(e.pointerId, local(e))
      dragDistance = 0
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()]
        pinchDist = Math.hypot(a.x - b.x, a.y - b.y)
      }
    }

    const onPointerMove = (e: PointerEvent) => {
      const p = local(e)
      const prev = pointers.get(e.pointerId)
      if (!prev || !cam) {
        updateHover(p.x, p.y)
        return
      }
      pointers.set(e.pointerId, p)
      if (pointers.size === 1) {
        dragDistance += Math.hypot(p.x - prev.x, p.y - prev.y)
        setCamera({
          x: cam.x - (p.x - prev.x) / cam.scale,
          y: cam.y - (p.y - prev.y) / cam.scale,
          scale: cam.scale,
        })
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()]
        const dist = Math.hypot(a.x - b.x, a.y - b.y)
        const cx = (a.x + b.x) / 2
        const cy = (a.y + b.y) / 2
        // pan by the midpoint's movement, then zoom around it
        const half = { x: (p.x - prev.x) / 2, y: (p.y - prev.y) / 2 }
        cam = { x: cam.x - half.x / cam.scale, y: cam.y - half.y / cam.scale, scale: cam.scale }
        if (pinchDist > 0) setCamera(zoomAt(cam, vp, cx, cy, dist / pinchDist))
        pinchDist = dist
        dragDistance = Infinity
      }
    }

    const onPointerUp = (e: PointerEvent) => {
      const p = local(e)
      const wasClick = pointers.size === 1 && dragDistance < 5
      pointers.delete(e.pointerId)
      if (pointers.size < 2) pinchDist = 0
      if (wasClick && e.pointerType === 'mouse' && hovered) {
        const { tile, i } = hovered
        const node = { a0: tile.a0[i], span: tile.span[i], r: tile.r[i] }
        flyTo(fitCamera(node, vp, 1.15, inset.current))
      } else if (wasClick) {
        updateHover(p.x, p.y)
      }
    }

    const onLeave = () => {
      hovered = null
      setHover(null)
      invalidate()
    }

    const onDoubleClick = (e: MouseEvent) => {
      if (!cam) return
      const { x, y } = local(e)
      const target = zoomAt(cam, vp, x, y, 4)
      flyTo(target)
    }

    const onKey = (e: KeyboardEvent) => {
      if (!cam || e.target instanceof HTMLInputElement) return
      const step = 80 / cam.scale
      const keys: Record<string, () => Camera> = {
        '+': () => zoomAt(cam!, vp, vp.width / 2, vp.height / 2, 1.5),
        '=': () => zoomAt(cam!, vp, vp.width / 2, vp.height / 2, 1.5),
        '-': () => zoomAt(cam!, vp, vp.width / 2, vp.height / 2, 1 / 1.5),
        ArrowLeft: () => ({ ...cam!, x: cam!.x - step }),
        ArrowRight: () => ({ ...cam!, x: cam!.x + step }),
        ArrowUp: () => ({ ...cam!, y: cam!.y - step }),
        ArrowDown: () => ({ ...cam!, y: cam!.y + step }),
      }
      const action = keys[e.key]
      if (action) {
        e.preventDefault()
        stopAnimation()
        setCamera(action())
      } else if (e.key === '0' || e.key === 'Home') {
        flyTo(homeCamera(vp, inset.current))
      }
    }

    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerup', onPointerUp)
    canvas.addEventListener('pointercancel', onPointerUp)
    canvas.addEventListener('pointerleave', onLeave)
    canvas.addEventListener('dblclick', onDoubleClick)
    window.addEventListener('keydown', onKey)

    return () => {
      observer.disconnect()
      stopAnimation()
      cancelAnimationFrame(raf)
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointercancel', onPointerUp)
      canvas.removeEventListener('pointerleave', onLeave)
      canvas.removeEventListener('dblclick', onDoubleClick)
      window.removeEventListener('keydown', onKey)
    }
  }, [manifest, dataUrl])

  return (
    <div className="tree-view">
      <canvas ref={canvasRef} aria-label="Zoomable tree of life" />
      {hover && (
        <div className="tooltip" style={{ left: hover.x + 14, top: hover.y + 14 }}>
          <div className={hover.name ? 'tooltip-name' : 'tooltip-name unnamed'}>
            {hover.name ?? 'Unnamed group'}
          </div>
          <div className="tooltip-meta">
            {hover.tips === 1 ? 'species' : `${hover.tips.toLocaleString()} species`}
            {hover.group && ` · ${hover.group}`}
          </div>
        </div>
      )}
    </div>
  )
}

// --- URL state: #v=<x>,<y>,<log2 scale> ------------------------------------

let lastHash = ''
let hashTimer = 0

function writeHash(cam: Camera) {
  const hash = `#v=${cam.x.toPrecision(17)},${cam.y.toPrecision(17)},${Math.log2(cam.scale).toFixed(3)}`
  if (hash === lastHash) return
  lastHash = hash
  clearTimeout(hashTimer)
  hashTimer = window.setTimeout(() => history.replaceState(null, '', hash), 250)
}

function readHash(): Camera | null {
  const m = /^#v=([-\d.e+]+),([-\d.e+]+),([-\d.e+]+)$/.exec(window.location.hash)
  if (!m) return null
  const [x, y, z] = m.slice(1).map(Number)
  if (![x, y, z].every(Number.isFinite)) return null
  return { x, y, scale: 2 ** z }
}
