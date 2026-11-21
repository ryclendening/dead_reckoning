import { useEffect, useState } from 'react'
import { Html } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { Plane } from 'lucide-react'
import { MathUtils, Vector3, type Camera, type Object3D } from 'three'
import { airfieldLabel, formationBaseGroups } from '../game/formationBasing'
import type { Asset, Squadron } from '../game/types'
import { FormationChip } from './FormationChip'
import { PanelPages } from './PanelPages'

const projected = new Vector3()

function fanPosition(object: Object3D, camera: Camera, { width, height }: { width: number; height: number }, fanWidth: number, paged: boolean) {
  object.getWorldPosition(projected).project(camera)
  const x = (projected.x + 1) * width / 2
  const y = (1 - projected.y) * height / 2 - 16
  if (x < 0 || x > width || y < 0 || y > height) return [-260, -260]
  // Keep the formation chips on screen when a runway is near an edge.
  const inset = Math.min(fanWidth / 2 + 6, width / 2)
  const distance = paged ? 70 : 49
  return [MathUtils.clamp(x, inset, width - inset), y < (paged ? 108 : 76) ? y + distance : y - distance]
}

export function AirfieldAircraft({ assets, squadrons, selectedId, plannedIds, mode, onSelect }: {
  assets: Asset[]
  squadrons: Squadron[]
  selectedId?: string
  plannedIds: string[]
  mode: 'plan' | 'review' | 'service'
  onSelect?: (id: string) => void
}) {
  const canvas = useThree(state => state.gl.domElement)
  const [expandedId, setExpandedId] = useState<string>()
  const groups = formationBaseGroups(squadrons, assets)
  const flightById = new Map(squadrons.filter(flight => flight.aircraft > 0).map(flight => [flight.id, flight]))

  useEffect(() => {
    if (!expandedId) return
    const close = () => setExpandedId(undefined)
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
    canvas.addEventListener('pointerdown', close)
    canvas.ownerDocument.addEventListener('keydown', escape)
    return () => {
      canvas.removeEventListener('pointerdown', close)
      canvas.ownerDocument.removeEventListener('keydown', escape)
    }
  }, [canvas, expandedId])

  return <group>{groups.map(({ base, formationIds }) => {
    const flights = formationIds.flatMap(id => flightById.get(id) ?? [])
    const count = flights.reduce((total, flight) => total + flight.aircraft, 0)
    const field = airfieldLabel(base)
    const label = `${field}: ${count} aircraft`
    const open = expandedId === base.id && count > 0
    const current = flights.some(flight => flight.id === selectedId)
    const fanWidth = Math.min(flights.length, 3) * 80 - 4
    const position: [number, number, number] = [base.position[0], 1.15, base.position[1]]
    return <group key={base.id}>
      <Html position={position} center zIndexRange={open ? [8, 8] : [7, 7]} style={{ pointerEvents: 'none' }}>
        {count > 0 ? <button type="button" className="airfield-aircraft-count" data-current={current}
          aria-label={label} aria-expanded={open} title={label} onPointerDown={event => event.stopPropagation()}
          onClick={event => { event.stopPropagation(); setExpandedId(open ? undefined : base.id) }}>
          <Plane aria-hidden="true"/><b>{count}</b>
        </button> : <span className="airfield-aircraft-count empty" aria-label={label}><Plane aria-hidden="true"/><b>0</b></span>}
      </Html>
      {open ? <Html position={position} center calculatePosition={(object, camera, size) => fanPosition(object, camera, size, fanWidth, flights.length > 3)} zIndexRange={[9, 9]} style={{ pointerEvents: 'none' }}>
        <div className="airfield-aircraft-fan" style={{ width: fanWidth }} role="group" aria-label={`Formations at ${field}`}>
          <PanelPages pageSize={3} label={`Formations at ${field}`} className="airfield-fan-chips">
            {flights.map(flight => <FormationChip key={flight.id} flight={flight} selected={flight.id === selectedId}
              cue={mode !== 'service' && plannedIds.includes(flight.id) ? 'planned' : undefined}
              disabled={mode !== 'service' && flight.status === 'trapped'} showCount
              onSelect={() => { setExpandedId(undefined); onSelect?.(flight.id) }}/>)}
          </PanelPages>
        </div>
      </Html> : null}
    </group>
  })}</group>
}
