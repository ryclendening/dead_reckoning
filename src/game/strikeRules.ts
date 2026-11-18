import { aircraftStrikeRange } from './aircraftTypes'
import type { AssetKind, Squadron, WeaponKind } from './types'

export const BOMBER_PAYLOADS = 3
export const BOMBER_DAMAGE = 100
export const BOMBER_BASE_DAMAGE = 50
export const FIGHTER_STRIKE_DAMAGE = 40
export const MAX_BOMBING_TARGETS = 3

export interface GroundAttackProfile {
  weapon: WeaponKind
  releaseRange: number
  payloads: number
}

export function groundAttackProfile(formation: Pick<Squadron, 'role' | 'aircraftTypeId' | 'upgrades'>): GroundAttackProfile {
  return formation.role === 'bomber'
    ? { weapon: 'bomb', releaseRange: aircraftStrikeRange(formation), payloads: BOMBER_PAYLOADS }
    : { weapon: 'air-to-ground-missile', releaseRange: aircraftStrikeRange(formation), payloads: 1 }
}

export function groundAttackDamage(formation: Pick<Squadron, 'role' | 'strength'>, target: AssetKind, strength = formation.strength ?? 100): number {
  const fullStrength = formation.role === 'bomber'
    ? target === 'base' ? BOMBER_BASE_DAMAGE : BOMBER_DAMAGE
    : FIGHTER_STRIKE_DAMAGE
  return Math.round(fullStrength * Math.max(0, Math.min(100, strength)) / 100)
}
