import type { Asset } from './types'
import { modifiedStat } from './upgrades'

export interface DefenseProfile { range: number; hitChance: number; damage: number; magazine: number; burstShots: number; cooldown: number }

const SAM_BASE: DefenseProfile = { range: 3.2, hitChance: .64, damage: 38, magazine: 3, burstShots: 1, cooldown: 3 }
const AAA_BASE: DefenseProfile = { range: 1.9, hitChance: .42, damage: 10, magazine: 1, burstShots: 5, cooldown: 0 }
export const RADAR_BASE_RANGE = 6.4
export const radarRange = (asset: Pick<Asset, 'upgrades'>) => modifiedStat(asset, 'ground.radar.range', RADAR_BASE_RANGE)

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
