import type { Asset } from './types'
import { modifiedStat } from './upgrades'

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
export interface EffectiveDefenseProfile extends DefenseProfile { baseRange: number; radarId?: string }
export const isOperationalSite = (asset: Pick<DefenseSite, 'health' | 'operational'>) => asset.health > 0 && asset.operational !== false

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

/** A battery inside a same-side radar's coverage can engage to its own
 * extended radius. Callers supply only same-side sites they are allowed to know. */
export function effectiveDefenseProfile(site: DefenseSite, sameSideSites: readonly DefenseSite[]): EffectiveDefenseProfile | undefined {
  const base = isOperationalSite(site) ? defenseProfile(site) : undefined
  if (!base) return undefined
  let range = base.range, radarId: string | undefined
  for (const radar of sameSideSites) {
    if (radar.kind !== 'radar' || !isOperationalSite(radar)) continue
    const radius = radarRange(radar)
    if (Math.hypot(site.position[0] - radar.position[0], site.position[1] - radar.position[1]) > radius) continue
    const extended = site.kind === 'sam' ? radius : base.range * RADAR_AAA_MULTIPLIER
    if (extended > range || extended === range && radarId !== undefined && radar.id < radarId) {
      range = extended
      radarId = radar.id
    }
  }
  return { ...base, range, baseRange: base.range, radarId }
}
