import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { Crosshair, Flag, Plane, Radar, Shield, Target } from 'lucide-react'
import { useRef, useState, type CSSProperties } from 'react'
import { OrthographicCamera, Vector3 } from 'three'
import type { Asset } from '../game/types'
import type { UnitCardData } from '../game/unitCards'

const siteNames: Record<Asset['kind'], string> = {
  base: 'Airbase', fob: 'FOB', decoy: 'Decoy', radar: 'Radar', sam: 'SAM', aaa: 'AAA',
}

const siteIcons = { base: Plane, fob: Flag, decoy: Target, radar: Radar, sam: Shield, aaa: Crosshair }

interface SiteLabel {
  asset: Asset
  data: UnitCardData
  color: string
  selected: boolean
  assigned: boolean
  action?: string
  belowBadge: boolean
  onSelect: () => void
}

function labelAnchor({ asset, belowBadge }: Pick<SiteLabel, 'asset' | 'belowBadge'>): [number, number, number] {
  const airfield = asset.kind === 'base' || asset.kind === 'fob'
  return [asset.position[0], airfield && belowBadge ? .2 : 1.05, asset.position[1]]
}

type Offset = readonly [x: number, y: number]
type Box = { x: number; y: number; width: number; height: number }

const MARKER_SIZE = 36
const CENTER: Offset = [0, 0]
const MARKER_OFFSETS: Offset[] = Array.from({ length: 25 }, (_, index): Offset =>
  [(index % 5 - 2) * 20, (Math.floor(index / 5) - 2) * 20],
).sort(([ax, ay], [bx, by]) => ax * ax + ay * ay - bx * bx - by * by)

function belowAircraftBadge(site: Pick<SiteLabel, 'asset' | 'belowBadge'>) {
  return site.belowBadge && (site.asset.kind === 'base' || site.asset.kind === 'fob')
}

function overlaps(a: Box, b: Box, gap: number) {
  return Math.abs(a.x - b.x) < (a.width + b.width) / 2 + gap
    && Math.abs(a.y - b.y) < (a.height + b.height) / 2 + gap
}

export function GroundSiteLabels({ sites }: { sites: SiteLabel[] }) {
  const [layout, setLayout] = useState({ compact: true, offsets: new Map<string, Offset>(), hidden: new Set<string>() })
  const lastLayout = useRef(layout)
  const position = useRef(new Vector3())

  useFrame(({ camera, size }) => {
    const project = (x: number, y: number, z: number) => {
      const point = position.current.set(x, y, z).project(camera)
      return { x: (point.x + 1) * size.width / 2, y: (1 - point.y) * size.height / 2 }
    }
    const inside = ({ x, y }: { x: number; y: number }, margin: number) =>
      x >= margin && x <= size.width - margin && y >= margin && y <= size.height - margin
    const anchors = sites.map(site => {
      const projected = project(...labelAnchor(site))
      const model = project(site.asset.position[0], .25, site.asset.position[1])
      return {
        id: site.asset.id,
        priority: site.selected || site.assigned ? 2 : site.action ? 1 : 0,
        model: { ...model, width: 12, height: 12 },
        full: { x: projected.x, y: projected.y + (belowAircraftBadge(site) ? 16 : -7), width: 128, height: site.action ? 48 : 32 },
      }
    }).filter(anchor => inside(anchor.full, -18))
    const badges = sites.filter(belowAircraftBadge).map(site => {
      const badge = project(site.asset.position[0], 1.15, site.asset.position[1])
      return { x: badge.x, y: badge.y - 16, width: 64, height: 44 }
    })
    const previous = lastLayout.current
    const gap = previous.compact ? 9 : 4
    const wide = camera instanceof OrthographicCamera && camera.zoom < (previous.compact ? 20 : 18)
    // Keep a consistent marker style at overview scale and whenever labels crowd one another.
    const compact = wide || anchors.some((anchor, index) => badges.some(badge => overlaps(anchor.full, badge, gap))
      || anchors.some((other, otherIndex) => index < otherIndex && overlaps(anchor.full, other.full, gap)))

    const offsets = new Map<string, Offset>()
    const hidden = new Set<string>()
    if (compact) {
      const occupied: Box[] = [...badges]
      for (const anchor of anchors.sort((a, b) => b.priority - a.priority)) {
        const offset = MARKER_OFFSETS.find(([dx, dy]) => {
          const box = { x: anchor.full.x + dx, y: anchor.full.y + dy, width: MARKER_SIZE, height: MARKER_SIZE }
          return inside(box, MARKER_SIZE / 2)
            && !occupied.some(other => overlaps(box, other, 3))
            && !anchors.some(other => other.id !== anchor.id && overlaps(box, other.model, 2))
        })
        if (!offset && anchor.priority === 0) {
          hidden.add(anchor.id)
          continue
        }
        const [x, y] = offset ?? CENTER
        if (offset && (x || y)) offsets.set(anchor.id, offset)
        occupied.push({ x: anchor.full.x + x, y: anchor.full.y + y, width: MARKER_SIZE, height: MARKER_SIZE })
      }
    }

    if (compact !== previous.compact || offsets.size !== previous.offsets.size
      || [...offsets].some(([id, offset]) => previous.offsets.get(id) !== offset)
      || hidden.size !== previous.hidden.size || [...hidden].some(id => !previous.hidden.has(id))) {
      const next = { compact, offsets, hidden }
      lastLayout.current = next
      setLayout(next)
    }
  })

  return <>{sites.filter(site => !layout.hidden.has(site.asset.id)).map(site => <GroundSiteLabel key={site.asset.id} {...site}
    compact={layout.compact} offset={layout.offsets.get(site.asset.id) ?? CENTER}/>)}</>
}

function GroundSiteLabel({ asset, data, color, selected, assigned, action, belowBadge, onSelect, compact, offset }: SiteLabel & { compact: boolean; offset: Offset }) {
  const [x, y] = offset
  const labelY = belowAircraftBadge({ asset, belowBadge }) ? 16 : -7
  const Icon = siteIcons[asset.kind]
  const health = Math.round(data.health)
  const fraction = Math.max(0, Math.min(1, data.health / Math.max(1, data.maxHealth)))
  const label = asset.name ?? siteNames[asset.kind]
  const description = `${data.title}, ${health} of ${data.maxHealth} HP${action ? `, ${action}` : ''}`
  return <Html center position={labelAnchor({ asset, belowBadge })}
    zIndexRange={selected ? [6, 6] : [5, 5]} style={{ pointerEvents: 'none' }}>
    <div className="ground-site-marker" style={{ transform: `translate(${x}px, ${labelY + y}px)` }}>
      {x || y ? <span className="ground-site-leader" aria-hidden="true" style={{
        width: Math.hypot(x, y),
        transform: `rotate(${Math.atan2(-y, -x)}rad)`,
      }}/> : null}
      <button type="button" className="ground-site-label"
        data-selected={selected} data-assigned={assigned} aria-pressed={selected || assigned}
        data-compact={compact} data-critical={fraction <= .3}
        style={{ '--site-color': color } as CSSProperties} aria-label={description} title={description}
        onPointerDown={event => event.stopPropagation()}
        onClick={event => { event.stopPropagation(); onSelect() }}>
        {compact ? <>
          <Icon aria-hidden="true"/>
          {fraction < 1 ? <span className="ground-site-damage-dot" aria-hidden="true"/> : null}
        </> : <>
          <span className="ground-site-heading"><b>{label}</b><span>{health} HP</span></span>
          <span className="ground-site-health" aria-hidden="true"><i style={{ width: `${fraction * 100}%` }}/></span>
          {action ? <span className="ground-site-action">{action}</span> : null}
        </>}
      </button>
    </div>
  </Html>
}
