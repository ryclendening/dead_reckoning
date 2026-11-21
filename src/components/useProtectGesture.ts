import { useEffect, useRef, useState } from 'react'
import { useThree } from '@react-three/fiber'
import { Plane, Raycaster, Vector2, Vector3 } from 'three'
import { clampProtectRadius, MIN_PROTECT_RADIUS } from '../game/missionResponsibility'
import type { Point } from '../game/types'

const HOLD_MS = 330
const SLOP_PX = 8
const ground = new Plane(new Vector3(0, 1, 0), 0)

type ProtectDraft = { center: Point; radius: number }
type PointerDraft = { id: number; x: number; y: number; timer: number; center?: Point; moved: boolean }

export function useProtectGesture(formationId: string, onConfirm?: (center: Point, radius: number) => void) {
  const { camera, gl, controls } = useThree()
  const [preview, setPreview] = useState<ProtectDraft>()
  const latest = useRef(onConfirm)
  latest.current = onConfirm
  const enabled = Boolean(onConfirm)

  useEffect(() => {
    if (!enabled) return
    const canvas = gl.domElement
    const ray = new Raycaster()
    const ndc = new Vector2()
    const hit = new Vector3()
    let draft: PointerDraft | undefined
    let suppressClickUntil = 0

    function position(x: number, y: number): Point | undefined {
      const bounds = canvas.getBoundingClientRect()
      ndc.set((x - bounds.left) / bounds.width * 2 - 1, 1 - (y - bounds.top) / bounds.height * 2)
      ray.setFromCamera(ndc, camera)
      return ray.ray.intersectPlane(ground, hit) ? [hit.x, hit.z] : undefined
    }

    function cancel() {
      if (!draft) return
      clearTimeout(draft.timer)
      if (draft.center && controls && 'enabled' in controls) controls.enabled = true
      draft = undefined
      setPreview(undefined)
    }

    function down(event: PointerEvent) {
      if (!event.isPrimary) {
        cancel()
        return
      }
      if (event.button !== 0) return
      cancel()
      suppressClickUntil = 0
      const { clientX: x, clientY: y, pointerId: id } = event
      draft = { id, x, y, moved: false, timer: window.setTimeout(() => {
        if (!draft || draft.id !== id) return
        const center = position(x, y)
        if (!center) return
        draft.center = center
        if (controls && 'enabled' in controls) controls.enabled = false
        setPreview({ center, radius: MIN_PROTECT_RADIUS })
      }, HOLD_MS) }
    }

    function move(event: PointerEvent) {
      if (!draft || draft.id !== event.pointerId) return
      const moved = Math.hypot(event.clientX - draft.x, event.clientY - draft.y) >= SLOP_PX
      if (!draft.center) {
        if (moved) cancel()
        return
      }
      event.stopImmediatePropagation()
      draft.moved ||= moved
      const edge = position(event.clientX, event.clientY)
      if (edge) setPreview({ center: draft.center, radius: clampProtectRadius(Math.hypot(edge[0] - draft.center[0], edge[1] - draft.center[1])) })
    }

    function up(event: PointerEvent) {
      if (!draft || draft.id !== event.pointerId) return
      const { center, moved } = draft
      const edge = center && position(event.clientX, event.clientY)
      if (center) suppressClickUntil = performance.now() + 400
      cancel()
      if (center && moved && edge) latest.current?.(center, Math.hypot(edge[0] - center[0], edge[1] - center[1]))
    }

    function click(event: MouseEvent) {
      if (performance.now() >= suppressClickUntil) return
      event.stopImmediatePropagation()
      suppressClickUntil = 0
    }

    const contextMenu = (event: MouseEvent) => event.preventDefault()
    canvas.addEventListener('pointerdown', down, true)
    canvas.addEventListener('pointermove', move, true)
    canvas.addEventListener('pointerup', up, true)
    canvas.addEventListener('pointercancel', cancel, true)
    canvas.addEventListener('lostpointercapture', cancel, true)
    canvas.addEventListener('click', click, true)
    canvas.addEventListener('contextmenu', contextMenu)
    return () => {
      canvas.removeEventListener('pointerdown', down, true)
      canvas.removeEventListener('pointermove', move, true)
      canvas.removeEventListener('pointerup', up, true)
      canvas.removeEventListener('pointercancel', cancel, true)
      canvas.removeEventListener('lostpointercapture', cancel, true)
      canvas.removeEventListener('click', click, true)
      canvas.removeEventListener('contextmenu', contextMenu)
      cancel()
    }
  }, [camera, controls, enabled, formationId, gl])

  return preview
}
