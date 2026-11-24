import type { Asset, Point } from './types'
import { modifiedStat } from './upgrades'

export const SAM_DEPLOYMENT_LIMIT = 3
export const SAM_FLIGHT_SECONDS=1.05
export const AAA_FLIGHT_SECONDS=.5
export const AAA_BURST_INTERVAL=.14

export interface DefenseProfile { range: number; hitChance: number; damage: number; magazine: number; burstShots: number; cooldown: number }

const SAM_BASE: DefenseProfile = { range: 3.2, hitChance: .64, damage: 38, magazine: 3, burstShots: 1, cooldown: 3 }
const AAA_BASE: DefenseProfile = { range: 1.9, hitChance: .42, damage: 10, magazine: 1, burstShots: 5, cooldown: 0 }
export const RADAR_BASE_RANGE = 6.4
export const RADAR_AAA_MULTIPLIER = 1.5
export const radarRange = (asset: Pick<Asset, 'upgrades'>) => modifiedStat(asset, 'ground.radar.range', RADAR_BASE_RANGE)
export type DefenseSite = Pick<Asset, 'id' | 'kind' | 'position' | 'health' | 'operational' | 'upgrades'>
export interface CoverageCircle { position: Point; radius: number }
export interface RadarLink extends CoverageCircle { id: string }
export interface EffectiveDefenseProfile extends DefenseProfile {
  baseRange: number
  radarLinks: RadarLink[]
  coverage: CoverageCircle[]
}
export const isOperationalSite = (asset: Pick<DefenseSite, 'health' | 'operational'>) => asset.health > 0 && asset.operational !== false
export const inCoverageCircle = (point: Point, { position, radius }: CoverageCircle) =>
  Math.hypot(point[0] - position[0], point[1] - position[1]) <= radius + 1e-9

export function defenseProfile(asset: Pick<Asset, 'kind' | 'upgrades'>): DefenseProfile | undefined {
  if (asset.kind === 'sam') return {
    range: modifiedStat(asset, 'ground.sam.range', SAM_BASE.range),
    hitChance: Math.min(1, modifiedStat(asset, 'ground.sam.hitChance', SAM_BASE.hitChance)),
    damage: modifiedStat(asset, 'ground.sam.damage', SAM_BASE.damage),
    magazine: Math.floor(modifiedStat(asset, 'ground.sam.missiles', SAM_BASE.magazine)), burstShots: SAM_BASE.burstShots,
    cooldown: modifiedStat(asset, 'ground.sam.cooldown', SAM_BASE.cooldown),
  }
  if (asset.kind === 'aaa') return {
    range: modifiedStat(asset, 'ground.aaa.range', AAA_BASE.range),
    hitChance: Math.min(1, modifiedStat(asset, 'ground.aaa.hitChance', AAA_BASE.hitChance)),
    damage: modifiedStat(asset, 'ground.aaa.damage', AAA_BASE.damage),
    magazine: AAA_BASE.magazine, burstShots: Math.floor(modifiedStat(asset, 'ground.aaa.shots', AAA_BASE.burstShots)),
    cooldown: AAA_BASE.cooldown,
  }
  return undefined
}

/** SAMs fire in their local circle or a linked radar's detection circle.
 * AAA keeps one circle centered on the gun. Callers supply known same-side sites. */
export function effectiveDefenseProfile(site: DefenseSite, sameSideSites: readonly DefenseSite[]): EffectiveDefenseProfile | undefined {
  const base = isOperationalSite(site) ? defenseProfile(site) : undefined
  if (!base) return undefined
  const links: RadarLink[] = []
  let fireControl = 0
  for (const radar of sameSideSites) {
    if (radar.kind !== 'radar' || !isOperationalSite(radar)) continue
    const link = { id: radar.id, position: radar.position, radius: radarRange(radar) }
    if (inCoverageCircle(site.position, link)) {
      links.push(link)
      fireControl = Math.max(fireControl, modifiedStat(radar, 'ground.radar.guidedHitChance', 0))
    }
  }
  links.sort((a, b) => a.id.localeCompare(b.id))
  const range = site.kind === 'aaa' && links.length ? base.range * RADAR_AAA_MULTIPLIER : base.range
  const radarLinks = site.kind === 'sam' ? links : links.slice(0, 1)
  const coverage = [{ position: site.position, radius: range }]
  if (site.kind === 'sam') coverage.push(...radarLinks)
  return { ...base, hitChance: Math.min(1, base.hitChance + fireControl), range, baseRange: base.range, radarLinks, coverage }
}
