import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { Crosshair, Flag, Plane, Radar, Shield, Target } from 'lucide-react'
import { useRef, useState, type CSSProperties } from 'react'
import { Vector3 } from 'three'
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

export function GroundSiteLabels({ sites }: { sites: SiteLabel[] }) {
  const [compactIds, setCompactIds] = useState<Set<string>>(() => new Set())
  const lastCompactIds = useRef(compactIds)
  const position = useRef(new Vector3())

  useFrame(({ camera, size }) => {
    const anchors = sites.map(site => {
      const projected = position.current.set(...labelAnchor(site)).project(camera)
      const belowBadge = site.belowBadge && (site.asset.kind === 'base' || site.asset.kind === 'fob')
      return {
        site,
        x: (projected.x + 1) * size.width / 2,
        y: (1 - projected.y) * size.height / 2 + (belowBadge ? 16 : -7),
        // Use the card's maximum footprint so zoom does not depend on name length.
        height: site.selected ? 28 : site.action ? 48 : 32,
        width: site.selected ? 28 : 128,
      }
    })
    const previous = lastCompactIds.current
    const next = new Set<string>()
    for (let i = 0; i < anchors.length; i++) {
      const a = anchors[i]
      for (let j = i + 1; j < anchors.length; j++) {
        const b = anchors[j]
        const buffer = previous.has(a.site.asset.id) || previous.has(b.site.asset.id) ? 12 : 4
        if (Math.abs(a.x - b.x) >= (a.width + b.width) / 2 + buffer || Math.abs(a.y - b.y) >= (a.height + b.height) / 2 + buffer) continue
        if (!a.site.selected) next.add(a.site.asset.id)
        if (!b.site.selected) next.add(b.site.asset.id)
      }
    }
    if (next.size !== previous.size || [...next].some(id => !previous.has(id))) {
      lastCompactIds.current = next
      setCompactIds(next)
    }
  })

  return <>{sites.map(site => <GroundSiteLabel key={site.asset.id} {...site}
    compact={site.selected || compactIds.has(site.asset.id)}/>)}</>
}

function GroundSiteLabel({ asset, data, color, selected, assigned, action, belowBadge, onSelect, compact }: SiteLabel & { compact: boolean }) {
  const airfield = asset.kind === 'base' || asset.kind === 'fob'
  const Icon = siteIcons[asset.kind]
  const health = Math.round(data.health)
  const fraction = Math.max(0, Math.min(1, data.health / Math.max(1, data.maxHealth)))
  const label = asset.name ?? siteNames[asset.kind]
  const description = `${data.title}, ${health} of ${data.maxHealth} HP${action ? `, ${action}` : ''}`
  return <Html center position={labelAnchor({ asset, belowBadge })}
    zIndexRange={selected ? [6, 6] : [5, 5]} style={{ pointerEvents: 'none' }}>
    <button type="button" className="ground-site-label"
      data-below-badge={airfield && belowBadge} data-selected={selected} data-assigned={assigned}
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
  </Html>
}
