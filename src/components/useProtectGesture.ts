import { useEffect, useEffectEvent, useState } from 'react'
import { useThree } from '@react-three/fiber'
import { Plane, Raycaster, Vector2, Vector3 } from 'three'
import { clampProtectRadius } from '../game/missionResponsibility'
import type { Point } from '../game/types'

export const WAYPOINT_HEIGHT = .18
export const WAYPOINT_HIT_RADIUS = .58
const DRAG_SLOP = 8
const waypointPlane = new Plane(new Vector3(0, 1, 0), -WAYPOINT_HEIGHT)

type ProtectDraft = { center: Point; radius: number }
type ProtectDrag = { id: number; x: number; y: number; center: Point; moved: boolean }

export function useProtectGesture(
  selectedWaypoint: Point | undefined,
  onConfirm: ((center: Point, radius: number) => void) | undefined,
  onDeselect: () => void,
) {
  const camera = useThree(state => state.camera)
  const canvas = useThree(state => state.gl.domElement)
  const [preview, setPreview] = useState<ProtectDraft>()
  const currentWaypoint = useEffectEvent(() => onConfirm ? selectedWaypoint : undefined)
  const confirm = useEffectEvent((center: Point, radius: number) => onConfirm?.(center, radius))
  const deselect = useEffectEvent(() => onDeselect())
  const enabled = Boolean(onConfirm)

  useEffect(() => {
    if (!enabled) return
    const ray = new Raycaster()
    const ndc = new Vector2()
    const hit = new Vector3()
    let drag: ProtectDrag | undefined
    let suppressClickUntil = 0

    function position(x: number, y: number): Point | undefined {
      const bounds = canvas.getBoundingClientRect()
      ndc.set((x - bounds.left) / bounds.width * 2 - 1, 1 - (y - bounds.top) / bounds.height * 2)
      ray.setFromCamera(ndc, camera)
      return ray.ray.intersectPlane(waypointPlane, hit) ? [hit.x, hit.z] : undefined
    }

    function cancel() {
      if (!drag) return
      const { id } = drag
      drag = undefined
      if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id)
      setPreview(undefined)
    }

    function down(event: PointerEvent) {
      if (!event.isPrimary) {
        cancel()
        return
      }
      if (event.button !== 0) return
      suppressClickUntil = 0
      const center = currentWaypoint()
      if (!center) return
      const { clientX: x, clientY: y, pointerId: id } = event
      const point = position(x, y)
      if (!point || Math.hypot(point[0] - center[0], point[1] - center[1]) > WAYPOINT_HIT_RADIUS) return

      // Capture before MapControls sees the down event so only this drag draws a ring.
      event.stopImmediatePropagation()
      canvas.setPointerCapture(id)
      drag = { id, x, y, center, moved: false }
    }

    function move(event: PointerEvent) {
      if (!drag || drag.id !== event.pointerId) return
      event.stopImmediatePropagation()
      drag.moved ||= Math.hypot(event.clientX - drag.x, event.clientY - drag.y) >= DRAG_SLOP
      if (!drag.moved) return

      const edge = position(event.clientX, event.clientY)
      if (edge) setPreview({ center: drag.center, radius: clampProtectRadius(Math.hypot(edge[0] - drag.center[0], edge[1] - drag.center[1])) })
    }

    function up(event: PointerEvent) {
      if (!drag || drag.id !== event.pointerId) return
      event.stopImmediatePropagation()
      const { center, moved } = drag
      const edge = position(event.clientX, event.clientY)
      suppressClickUntil = performance.now() + 400
      cancel()
      if (!moved) deselect()
      else if (edge && center === currentWaypoint()) confirm(center, Math.hypot(edge[0] - center[0], edge[1] - center[1]))
    }

    function cancelPointer(event: PointerEvent) {
      if (event.pointerId === drag?.id) cancel()
    }

    function click(event: MouseEvent) {
      if (performance.now() >= suppressClickUntil) return
      event.stopImmediatePropagation()
      suppressClickUntil = 0
    }

    canvas.addEventListener('pointerdown', down, true)
    canvas.addEventListener('pointermove', move, true)
    canvas.addEventListener('pointerup', up, true)
    canvas.addEventListener('pointercancel', cancelPointer, true)
    canvas.addEventListener('lostpointercapture', cancelPointer, true)
    canvas.addEventListener('click', click, true)
    return () => {
      canvas.removeEventListener('pointerdown', down, true)
      canvas.removeEventListener('pointermove', move, true)
      canvas.removeEventListener('pointerup', up, true)
      canvas.removeEventListener('pointercancel', cancelPointer, true)
      canvas.removeEventListener('lostpointercapture', cancelPointer, true)
      canvas.removeEventListener('click', click, true)
      cancel()
    }
  }, [camera, canvas, enabled])

  return preview
}
