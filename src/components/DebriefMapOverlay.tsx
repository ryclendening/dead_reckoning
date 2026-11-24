import { useRef, useState } from 'react'
import { Html } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { OrthographicCamera, Vector3 } from 'three'
import { primaryDebriefEvent, type DebriefMapSite } from '../game/debriefMap'
import type { Point } from '../game/types'
import { DebriefSymbol } from './DebriefSymbols'

export type DebriefFocus = (point: Point, eventId?: string, zoom?: number) => void

const PIN_HEIGHT = .65
const TAP_TARGET = 44

export function groupDebriefPins(pins: { id: string; x: number; y: number }[], priorityId?: string): string[][] {
  const priority = pins.find(pin => pin.id === priorityId)
  const ordered = priority ? [priority, ...pins.filter(pin => pin !== priority)] : pins
  const groups: { anchor: typeof pins[number]; ids: string[] }[] = []
  for (const pin of ordered) {
    const nearby = groups.find(({ anchor }) => Math.abs(anchor.x - pin.x) < TAP_TARGET + 4
      && Math.abs(anchor.y - pin.y) < TAP_TARGET + 4)
    if (nearby) nearby.ids.push(pin.id)
    else groups.push({ anchor: pin, ids: [pin.id] })
  }
  return groups.map(group => group.ids)
}

export function DebriefMapOverlay({ sites, focusPoint, focusedEvent, onFocus }: {
  sites: DebriefMapSite[]
  focusPoint?: Point
  focusedEvent?: string
  onFocus?: DebriefFocus
}) {
  const [expanded, setExpanded] = useState<string>()
  const [groups, setGroups] = useState<string[][]>([])
  const lastLayout = useRef('')
  const projected = useRef(new Vector3())
  const camera = useThree(state => state.camera)
  const focusedSite = sites.find(site => focusedEvent
    ? site.events.some(event => event.id === focusedEvent)
    : focusPoint?.[0] === site.position[0] && focusPoint?.[1] === site.position[1])
  const priorityId = focusedSite?.id ?? expanded

  useFrame(({ camera, size }) => {
    const pins = sites.flatMap(site => {
      const point = projected.current.set(site.position[0], PIN_HEIGHT, site.position[1]).project(camera)
      const x = (point.x + 1) * size.width / 2
      const y = (1 - point.y) * size.height / 2
      return x < -22 || x > size.width + 22 || y < -22 || y > size.height + 22 ? [] : [{ id: site.id, x, y }]
    })
    const layout = groupDebriefPins(pins, priorityId)
    const signature = JSON.stringify(layout)
    if (lastLayout.current === signature) return
    lastLayout.current = signature
    setGroups(layout)
  })

  const siteById = new Map(sites.map(site => [site.id, site]))
  const expandedVisible = groups.some(group => group.length === 1 && group[0] === expanded)

  return <group>{groups.map(([id, ...nearby]) => {
    const site = siteById.get(id)
    if (!site) return null
    const anchor: [number, number, number] = [site.position[0], PIN_HEIGHT, site.position[1]]
    const focused = focusedSite?.id === id
    if (nearby.length) {
      const count = nearby.length + 1
      return <Html key={id} position={anchor} center zIndexRange={focused ? [9, 8] : [7, 6]} style={{ pointerEvents: 'none' }}>
        <button type="button" className={`debrief-map-pin debrief-cluster-pin ${focused ? 'selected' : ''}`}
          aria-label={`Zoom in on ${count} event sites`} onPointerDown={event => event.stopPropagation()} onClick={event => {
            event.stopPropagation()
            setExpanded(undefined)
            onFocus?.(site.position, undefined, camera instanceof OrthographicCamera ? camera.zoom * 1.8 : undefined)
          }}>
          <span>{count}</span>
        </button>
      </Html>
    }

    const event = primaryDebriefEvent(site)
    const symbols = [event, ...site.events.filter(item => item.id !== event.id)]
      .filter((item, index, array) => array.findIndex(other => other.kind === item.kind && other.side === item.side) === index)
    const stacked = site.events.length > 1
    const open = expanded === id
    return <Html key={id} position={anchor} center zIndexRange={open || focused ? [9, 8] : [7, 6]} style={{ pointerEvents: 'none' }}>
      <div className="debrief-pin-group" data-dimmed={expandedVisible && !open}>
        <button type="button" className={`debrief-map-pin ${event.side} ${focused ? 'selected' : ''}`}
          aria-label={`Site ${site.number}: ${stacked ? `${site.events.length} reports` : event.title}`}
          aria-expanded={stacked ? open : undefined} onPointerDown={e => e.stopPropagation()} onClick={e => {
            e.stopPropagation()
            setExpanded(stacked && !open ? id : undefined)
            if (!open) onFocus?.(site.position, stacked ? undefined : event.id)
          }}>
          <DebriefSymbol kind={event.kind}/><b>{site.number}</b>{stacked ? <span className="debrief-stack-count">{site.events.length}</span> : null}
        </button>
        {open ? <div className="debrief-fan" role="group" aria-label={`Reports at site ${site.number}`}>
          {symbols.map((symbol, index) => {
            const angle = Math.PI * 2 * index / symbols.length - Math.PI / 2
            const radius = Math.max(TAP_TARGET, symbols.length * 7)
            const category = site.events.filter(item => item.kind === symbol.kind && item.side === symbol.side)
            const active = category.some(item => item.id === focusedEvent)
            return <button type="button" key={symbol.id} className={`debrief-fan-pin ${symbol.side}`}
              aria-label={`${symbol.title}, ${category.length} ${category.length === 1 ? 'report' : 'reports'}`} aria-pressed={active}
              style={{ transform: `translate(${Math.cos(angle) * radius}px,${Math.sin(angle) * radius}px)` }}
              onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); onFocus?.(site.position, symbol.id) }}>
              <DebriefSymbol kind={symbol.kind}/>{category.length > 1 ? <small>{category.length}</small> : null}
            </button>
          })}
        </div> : null}
      </div>
    </Html>
  })}</group>
}
