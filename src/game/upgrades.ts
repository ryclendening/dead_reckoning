import type { Asset, AssetKind, Squadron, UpgradeId } from './types'
import { LOGISTICS_EFFECTS, LOGISTICS_COSTS } from './economyRules'

export type UpgradeStat =
  | 'aircraft.speed' | 'aircraft.range' | 'aircraft.sensorRange'
  | 'ground.sam.range' | 'ground.sam.hitChance' | 'ground.sam.damage' | 'ground.sam.missiles' | 'ground.sam.cooldown'
  | 'ground.aaa.range' | 'ground.aaa.hitChance' | 'ground.aaa.damage' | 'ground.aaa.shots'
  | 'ground.radar.range'
  | 'economy.baseIncome' | 'economy.formationRepairCost' | 'economy.aircraftReplacementCost'

export interface UpgradeDefinition {
  id: UpgradeId
  label: string
  detail: string
  cost: number
  /** Targets use campaign object types so upgrades can be installed per squadron or per site. */
  targets: Array<'squadron' | AssetKind>
  /** Optional shared slot, used for mutually exclusive choices such as the main-airfield upgrade. */
  group?: string
  modifiers: Partial<Record<UpgradeStat, { add?: number; multiply?: number }>>
}

/** Add upgrades here. Their stat modifiers are resolved by the corresponding simulation rules. */
export const UPGRADE_CATALOG: readonly UpgradeDefinition[] = [
  {
    id: 'maintenance-wing', label: 'MAINTENANCE WING',
    detail: 'Formation repair and replacement cost 1 less.', cost: LOGISTICS_COSTS.upgrade, targets: ['base'], group: 'main-airfield',
    modifiers: { 'economy.formationRepairCost': { add: -1 }, 'economy.aircraftReplacementCost': { add: -1 } },
  },
  {
    id: 'supply-depot', label: 'SUPPLY DEPOT',
    detail: `Future completed rounds gain +${LOGISTICS_EFFECTS.supplyDepotIncome} Logistics.`, cost: LOGISTICS_COSTS.upgrade, targets: ['base'], group: 'main-airfield',
    modifiers: { 'economy.baseIncome': { add: 2 } },
  },
]

export function upgradeDefinition(id: UpgradeId | undefined): UpgradeDefinition | undefined {
  return UPGRADE_CATALOG.find(upgrade => upgrade.id === id)
}

export const isKnownUpgradeId = (id: unknown): id is UpgradeId => typeof id === 'string' && UPGRADE_CATALOG.some(upgrade => upgrade.id === id)

export function modifiedStat(owner: Pick<Squadron, 'upgrades'> | Pick<Asset, 'upgrades'> | undefined, stat: UpgradeStat, base: number): number {
  if (!owner?.upgrades?.length) return base
  let value = base
  for (const id of owner.upgrades) {
    const modifier = upgradeDefinition(id)?.modifiers[stat]
    if (!modifier) continue
    if (modifier.multiply !== undefined) value *= modifier.multiply
    if (modifier.add !== undefined) value += modifier.add
  }
  return Math.max(0, value)
}

