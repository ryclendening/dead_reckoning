import type { Asset, AssetKind, Squadron, UpgradeId, Role } from './types'
import { formatCash, LOGISTICS_EFFECTS, LOGISTICS_COSTS } from './economyRules'

export type UpgradeStat =
  | 'aircraft.speed' | 'aircraft.range' | 'aircraft.sensorRange' | 'aircraft.strikeRange' | 'aircraft.groundAttackDamage' | 'aircraft.reconSurveyRange'
  | 'ground.sam.range' | 'ground.sam.hitChance' | 'ground.sam.damage' | 'ground.sam.missiles' | 'ground.sam.cooldown'
  | 'ground.aaa.range' | 'ground.aaa.hitChance' | 'ground.aaa.damage' | 'ground.aaa.shots'
  | 'ground.radar.range' | 'ground.radar.guidedHitChance'
  | 'economy.baseIncome' | 'economy.formationRepairCost' | 'economy.aircraftReplacementCost'

export interface UpgradeDefinition {
  id: UpgradeId
  label: string
  detail: string
  cost: number
  /** Targets use campaign object types so upgrades can be installed per squadron or per site. */
  targets: Array<'squadron' | AssetKind>
  roles?: Role[]
  /** Optional shared slot, used for mutually exclusive choices such as the main-airfield upgrade. */
  group?: string
  modifiers: Partial<Record<UpgradeStat, { add?: number; multiply?: number }>>
}

/** Add upgrades here. Their stat modifiers are resolved by the corresponding simulation rules. */
export const UPGRADE_CATALOG: readonly UpgradeDefinition[] = [
  {
    id: 'maintenance-wing', label: 'MAINTENANCE WING',
    detail: `Formation repairs cost ${formatCash(1)} less.`, cost: LOGISTICS_COSTS.upgrade, targets: ['base'], group: 'main-airfield',
    modifiers: { 'economy.formationRepairCost': { add: -1 } },
  },
  {
    id: 'supply-depot', label: 'SUPPLY DEPOT',
    detail: `Future completed rounds pay an extra ${formatCash(LOGISTICS_EFFECTS.supplyDepotIncome)}.`, cost: LOGISTICS_COSTS.upgrade, targets: ['base'], group: 'main-airfield',
    modifiers: { 'economy.baseIncome': { add: LOGISTICS_EFFECTS.supplyDepotIncome } },
  },
  {
    id: 'wide-scan', label: 'Wide Scan', detail: 'Radar range +1.6 map units.', cost: 8, targets: ['radar'], group: 'radar',
    modifiers: { 'ground.radar.range': { add: 1.6 } },
  },
  {
    id: 'fire-control', label: 'Fire Control', detail: 'Linked batteries gain 8 percentage points of hit chance. Multiple radars do not stack.', cost: 8, targets: ['radar'], group: 'radar',
    modifiers: { 'ground.radar.guidedHitChance': { add: .08 } },
  },
  {
    id: 'sam-range', label: 'Long Reach', detail: 'Local SAM range +0.8 map units.', cost: 8, targets: ['sam'], group: 'sam',
    modifiers: { 'ground.sam.range': { add: .8 } },
  },
  {
    id: 'sam-magazine', label: 'Reserve Missile', detail: 'Load one extra missile each round.', cost: 8, targets: ['sam'], group: 'sam',
    modifiers: { 'ground.sam.missiles': { add: 1 } },
  },
  {
    id: 'aaa-range', label: 'Long Reach', detail: 'Standalone AAA range +0.6 map units before radar support.', cost: 6, targets: ['aaa'], group: 'aaa',
    modifiers: { 'ground.aaa.range': { add: .6 } },
  },
  {
    id: 'aaa-burst', label: 'Extended Burst', detail: 'Fire two extra shots per burst.', cost: 6, targets: ['aaa'], group: 'aaa',
    modifiers: { 'ground.aaa.shots': { add: 2 } },
  },
  {
    id: 'extended-tanks', label: 'Extended Tanks', detail: 'Flight range +20%.', cost: 8, targets: ['squadron'], group: 'aircraft',
    modifiers: { 'aircraft.range': { multiply: 1.2 } },
  },
  {
    id: 'precision-ordnance', label: 'Precision Ordnance', detail: 'Fighter strikes deal up to 15 extra damage to support sites. Bomber base hits deal up to 15 extra damage.', cost: 8, targets: ['squadron'], roles: ['fighter', 'bomber'], group: 'aircraft',
    modifiers: { 'aircraft.groundAttackDamage': { add: 15 } },
  },
  {
    id: 'survey-pod', label: 'Survey Pod', detail: 'Recon observes ground sites from 2 map units farther away.', cost: 8, targets: ['squadron'], roles: ['recon'], group: 'aircraft',
    modifiers: { 'aircraft.reconSurveyRange': { add: 2 } },
  },
]

export function upgradesFor(kind: AssetKind | 'squadron', role?: Role) {
  return UPGRADE_CATALOG.filter(upgrade => upgrade.targets.includes(kind)
    && (!upgrade.roles || role && upgrade.roles.includes(role)))
}

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

