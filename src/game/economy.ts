import type { Asset, AssetUpgradeId, ConstructibleAssetKind, EconomyActionId, EconomyActionQuote, EconomyCommand, EconomyEffect, EconomyState, EconomyTarget, LogisticsIncome, LogisticsStatementEntry, MatchState, RoundResult, Squadron } from './types'
import { MAPPED_RADIUS } from './fog'
import { formationField, normalizeFormationBasing } from './forwardBasing'
import { friendlyTerritoryForAssets, territoryContains } from './territory'

export const LOGISTICS_COSTS = { formationRepair: 2, aircraftReplacement: 4, defenseRepair: 2, fobRepair: 4, upgrade: 12, fobConstruction: 8, decoyConstruction: 4, aaaConstruction: 6, samConstruction: 8 } as const
export const LOGISTICS_EFFECTS = { formationRepair: 25, defenseRepair: 25, baseIncome: 6, intelRecovery: 2, confirmedEnemyAircraft: 1, supplyDepotIncome: 2 } as const
export const FOB_INITIAL_CAPACITY = 1
export const FOB_PLACEMENT_SPACING = 1.5

export const createEconomyState = (): EconomyState => ({ statement: [] })

const upgradesFor = (asset: Asset | undefined) => asset?.upgrades ?? []
const hasUpgrade = (state: MatchState, upgrade: AssetUpgradeId) => upgradesFor(state.playerAssets.find(asset => asset.kind === 'base')).includes(upgrade)
const formationCapacity = (squadron: Squadron) => Math.min(100, squadron.aircraft / Math.max(1, squadron.maxAircraft) * 100)
const strengthOf = (squadron: Squadron) => squadron.strength ?? formationCapacity(squadron)
export const economyTargetsEqual = (left: EconomyTarget, right: EconomyTarget) => left.kind === right.kind && left.id === right.id
const pointDistance = (left: [number, number], right: [number, number]) => Math.hypot(left[0] - right[0], left[1] - right[1])
const constructionCount = (state: MatchState, kind: ConstructibleAssetKind) => state.playerAssets.filter(asset => asset.kind === kind).length
const constructionName = (state: MatchState, kind: ConstructibleAssetKind) => {
  const count = constructionCount(state, kind)
  if (kind === 'fob') return `FOB ${['ALPHA', 'BRAVO', 'CHARLIE', 'DELTA', 'ECHO', 'FOXTROT'][count] ?? String(count + 1).padStart(2, '0')}`
  return `${kind === 'decoy' ? 'DECOY' : `${kind.toUpperCase()} SITE`} ${count + 1}`
}
const constructionId = (state: MatchState, kind: ConstructibleAssetKind) => `p-${kind}-${constructionCount(state, kind) + 1}`

interface ProcurementDefinition {
  actionId: Extract<EconomyActionId, `build-${string}`>
  kind: ConstructibleAssetKind
  cost: number
  maxHealth: number
  detail: string
  capacity?: number
}

export const PROCUREMENT_CATALOG: readonly ProcurementDefinition[] = [
  { actionId: 'build-fob', kind: 'fob', cost: LOGISTICS_COSTS.fobConstruction, maxHealth: 100, capacity: FOB_INITIAL_CAPACITY, detail: `Operational forward field with capacity for ${FOB_INITIAL_CAPACITY} formation.` },
  { actionId: 'build-decoy', kind: 'decoy', cost: LOGISTICS_COSTS.decoyConstruction, maxHealth: 60, detail: 'Creates a false airfield target that can draw hostile attacks.' },
  { actionId: 'build-aaa', kind: 'aaa', cost: LOGISTICS_COSTS.aaaConstruction, maxHealth: 100, detail: 'Short-range gun defense with a 1.9-unit engagement radius.' },
  { actionId: 'build-sam', kind: 'sam', cost: LOGISTICS_COSTS.samConstruction, maxHealth: 100, detail: 'Missile defense with a 3.2-unit engagement radius.' },
]

interface AirfieldUpgradeDefinition {
  actionId: Extract<EconomyActionId, `install-${string}`>
  upgrade: AssetUpgradeId
  label: string
  detail: string
}

export const AIRFIELD_UPGRADE_CATALOG: readonly AirfieldUpgradeDefinition[] = [
  { actionId: 'install-maintenance-wing', upgrade: 'maintenance-wing', label: 'MAINTENANCE WING', detail: 'Formation repair and replacement cost 1 less.' },
  { actionId: 'install-supply-depot', upgrade: 'supply-depot', label: 'SUPPLY DEPOT', detail: `Future completed rounds gain +${LOGISTICS_EFFECTS.supplyDepotIncome} Logistics.` },
]

export interface FobPlacementValidation { valid: boolean; reason?: string }
export function validateAssetPlacement(state: MatchState, _kind: ConstructibleAssetKind, placement: [number, number] | undefined): FobPlacementValidation {
  if (!placement || !Number.isFinite(placement[0]) || !Number.isFinite(placement[1])) return { valid: false, reason: 'SELECT A MAP LOCATION' }
  const territory = friendlyTerritoryForAssets(state.world.friendlyTerritory,state.playerAssets)
  const persistentlyKnown = territoryContains(placement,territory) || state.mappedAreas.some(area => pointDistance(placement, area) <= MAPPED_RADIUS)
  if (!persistentlyKnown) return { valid: false, reason: 'SITE MUST BE IN RECOVERED TERRITORY' }
  if (state.playerAssets.some(asset => pointDistance(placement, asset.position) < FOB_PLACEMENT_SPACING)) return { valid: false, reason: 'SITE TOO CLOSE TO AN EXISTING ASSET' }
  return { valid: true }
}
export const validateFobPlacement = (state: MatchState, placement: [number, number] | undefined) => validateAssetPlacement(state, 'fob', placement)

export function deriveLogisticsIncome(state: MatchState, result: Pick<RoundResult, 'enemyLosses' | 'intelReports'>): LogisticsIncome {
  const base = LOGISTICS_EFFECTS.baseIncome + (hasUpgrade(state, 'supply-depot') ? LOGISTICS_EFFECTS.supplyDepotIncome : 0)
  const intel = result.intelReports.filter(report => report.recovered).length * LOGISTICS_EFFECTS.intelRecovery
  const enemyAircraft = result.enemyLosses * LOGISTICS_EFFECTS.confirmedEnemyAircraft
  return { base, intel, enemyAircraft, total: base + intel + enemyAircraft }
}

export function settleLogisticsIncome(state: MatchState, result: RoundResult): MatchState {
  if (state.economy.lastSettledRound === result.round) return state
  const income = result.logisticsIncome
  const entries: LogisticsStatementEntry[] = [
    { id: `income-${result.round}-base`, round: result.round, direction: 'income', amount: income.base, label: income.base > LOGISTICS_EFFECTS.baseIncome ? 'ROUND LOGISTICS · SUPPLY DEPOT' : 'ROUND LOGISTICS', source: 'round-income' },
    ...(income.intel ? [{ id: `income-${result.round}-intel`, round: result.round, direction: 'income' as const, amount: income.intel, label: 'INTELLIGENCE RECOVERY', source: 'intel-recovery' }] : []),
    ...(income.enemyAircraft ? [{ id: `income-${result.round}-enemy-aircraft`, round: result.round, direction: 'income' as const, amount: income.enemyAircraft, label: 'CONFIRMED ENEMY AIRCRAFT', source: 'enemy-aircraft' }] : []),
  ]
  return { ...state, logistics: state.logistics + income.total, economy: { lastSettledRound: result.round, statement: entries } }
}

const projection = (state: MatchState, cost: number, reserveCost = 0) => ({ logistics: state.logistics - cost, reserveAircraft: state.replacements - reserveCost })
const eligibility = (state: MatchState, cost: number, reserveCost = 0) => state.phase !== 'adapt'
  ? { eligible: false, reason: 'AVAILABLE IN ADAPT ONLY' }
  : state.logistics < cost
    ? { eligible: false, reason: 'INSUFFICIENT LOGISTICS' }
    : state.replacements < reserveCost
      ? { eligible: false, reason: 'NO RESERVE AIRCRAFT' }
      : { eligible: true }

interface EconomyActionDefinition {
  id: EconomyActionId
  quote: (state: MatchState, target: EconomyTarget, command?: EconomyCommand) => EconomyActionQuote | undefined
  apply: (state: MatchState, target: EconomyTarget, command: EconomyCommand) => MatchState | undefined
}

const createQuote = (state: MatchState, id: EconomyActionId, target: EconomyTarget, label: string, detail: string, cost: number, effect: EconomyEffect, reserveCost = 0): EconomyActionQuote => ({
  id, target, label, detail, cost, ...(reserveCost ? { reserveCost } : {}), effect,
  projected: projection(state, cost, reserveCost),
  ...eligibility(state, cost, reserveCost),
})

const ACTIONS: readonly EconomyActionDefinition[] = [
  {
    id: 'repair-formation',
    quote: (state, target) => {
      if (target.kind !== 'squadron') return undefined
      const squadron = state.squadrons.find(item => item.id === target.id)
      if (!squadron) return undefined
      const before = strengthOf(squadron); const after = Math.min(formationCapacity(squadron), before + LOGISTICS_EFFECTS.formationRepair)
      if (after <= before + .01) return undefined
      const cost = Math.max(0, LOGISTICS_COSTS.formationRepair - (hasUpgrade(state, 'maintenance-wing') ? 1 : 0))
      return createQuote(state, 'repair-formation', target, 'REPAIR FORMATION', `Strength ${Math.round(before)} → ${Math.round(after)} (+${Math.round(after - before)}).`, cost, { kind: 'formation-strength', before, after })
    },
    apply: (state, target) => target.kind === 'squadron' ? { ...state, squadrons: state.squadrons.map(squadron => squadron.id !== target.id ? squadron : { ...squadron, strength: Math.min(formationCapacity(squadron), strengthOf(squadron) + LOGISTICS_EFFECTS.formationRepair) }) } : undefined,
  },
  {
    id: 'replace-aircraft',
    quote: (state, target) => {
      if (target.kind !== 'squadron') return undefined
      const squadron = state.squadrons.find(item => item.id === target.id)
      if (!squadron || squadron.aircraft >= squadron.maxAircraft) return undefined
      const cost = Math.max(0, LOGISTICS_COSTS.aircraftReplacement - (hasUpgrade(state, 'maintenance-wing') ? 1 : 0))
      const strengthBefore = strengthOf(squadron); const strengthAfter = Math.min(100, strengthBefore + 25)
      const effect: EconomyEffect = { kind: 'aircraft-replacement', aircraftBefore: squadron.aircraft, aircraftAfter: squadron.aircraft + 1, strengthBefore, strengthAfter }
      return createQuote(state, 'replace-aircraft', target, 'REPLACE AIRCRAFT', `Aircraft ${squadron.aircraft} → ${squadron.aircraft + 1} · Strength ${Math.round(strengthBefore)} → ${Math.round(strengthAfter)}.`, cost, effect, 1)
    },
    apply: (state, target) => {
      if (target.kind !== 'squadron') return undefined
      const before = state.squadrons.find(squadron => squadron.id === target.id)
      if (!before) return undefined
      const wasLost = before.aircraft <= 0
      const squadrons = state.squadrons.map(squadron => squadron.id !== target.id ? squadron : { ...squadron, aircraft: squadron.aircraft + 1, strength: Math.min(100, strengthOf(squadron) + 25), status: 'rtb' as const })
      let playerAssets = normalizeFormationBasing(squadrons, state.playerAssets)
      if (wasLost) playerAssets = playerAssets.map(asset => asset.kind === 'base' ? { ...asset, basedFormationIds: [...new Set([...(asset.basedFormationIds ?? []), target.id])] } : asset.kind === 'fob' ? { ...asset, basedFormationIds: (asset.basedFormationIds ?? []).filter(id => id !== target.id) } : asset)
      return { ...state, squadrons, playerAssets }
    },
  },
  {
    id: 'repair-defense',
    quote: (state, target) => {
      if (target.kind !== 'asset') return undefined
      const asset = state.playerAssets.find(item => item.id === target.id)
      if (!asset || !['radar', 'sam', 'aaa'].includes(asset.kind)) return undefined
      const before = asset.health; const after = Math.min(asset.maxHealth, before + LOGISTICS_EFFECTS.defenseRepair)
      if (after <= before + .01) return undefined
      return createQuote(state, 'repair-defense', target, `REPAIR ${asset.kind.toUpperCase()}`, `Health ${Math.round(before)} → ${Math.round(after)} (+${Math.round(after - before)}).`, LOGISTICS_COSTS.defenseRepair, { kind: 'asset-health', before, after })
    },
    apply: (state, target) => target.kind === 'asset' ? { ...state, playerAssets: state.playerAssets.map(asset => asset.id !== target.id ? asset : { ...asset, health: Math.min(asset.maxHealth, asset.health + LOGISTICS_EFFECTS.defenseRepair) }) } : undefined,
  },
  {
    id: 'repair-fob',
    quote: (state, target) => {
      if (target.kind !== 'asset') return undefined
      const asset = state.playerAssets.find(item => item.id === target.id)
      if (!asset || asset.kind !== 'fob' || asset.operational !== false) return undefined
      return createQuote(state, 'repair-fob', target, `REPAIR ${asset.name ?? 'FOB'}`, 'Restore the forward field to operational status. Based formations may launch next round.', LOGISTICS_COSTS.fobRepair, { kind: 'asset-operational', before: false, after: true })
    },
    apply: (state, target) => {
      if (target.kind !== 'asset') return undefined
      const fob = state.playerAssets.find(asset => asset.id === target.id && asset.kind === 'fob')
      if (!fob) return undefined
      const based = new Set(fob.basedFormationIds ?? [])
      return { ...state, playerAssets: state.playerAssets.map(asset => asset.id === fob.id ? { ...asset, operational: true, health: asset.maxHealth } : asset), squadrons: state.squadrons.map(squadron => based.has(squadron.id) && squadron.status === 'trapped' ? { ...squadron, status: 'rtb' } : squadron) }
    },
  },
  ...AIRFIELD_UPGRADE_CATALOG.map<EconomyActionDefinition>(definition => {
    return {
      id: definition.actionId,
      quote: (state, target) => {
        if (target.kind !== 'asset') return undefined
        const asset = state.playerAssets.find(item => item.id === target.id)
        if (!asset || asset.kind !== 'base' || upgradesFor(asset).length) return undefined
        return createQuote(state, definition.actionId, target, definition.label, definition.detail, LOGISTICS_COSTS.upgrade, { kind: 'airfield-upgrade', upgrade: definition.upgrade })
      },
      apply: (state, target) => target.kind === 'asset' ? { ...state, playerAssets: state.playerAssets.map(asset => asset.id !== target.id ? asset : { ...asset, upgrades: [definition.upgrade] }) } : undefined,
    }
  }),
  ...PROCUREMENT_CATALOG.map<EconomyActionDefinition>(definition => ({
    id: definition.actionId,
    quote: (state, target, command) => {
      if (target.kind !== 'campaign') return undefined
      const name = constructionName(state, definition.kind)
      const effect: EconomyEffect = { kind: 'asset-construction', assetKind: definition.kind, name, ...(definition.capacity ? { capacity: definition.capacity } : {}) }
      const base = createQuote(state, definition.actionId, target, `BUILD ${name}`, definition.detail, definition.cost, effect)
      const placement = command?.placement ? validateAssetPlacement(state, definition.kind, command.placement) : undefined
      return placement && !placement.valid ? { ...base, eligible: false, reason: placement.reason } : base
    },
    apply: (state, target, command) => {
      if (target.kind !== 'campaign' || !command.placement || !validateAssetPlacement(state, definition.kind, command.placement).valid) return undefined
      const asset: Asset = {
        id: constructionId(state, definition.kind), kind: definition.kind, name: constructionName(state, definition.kind), position: [...command.placement],
        intel: 'confirmed', confidence: 100, health: definition.maxHealth, maxHealth: definition.maxHealth, hidden: false, struck: false,
        ...(definition.kind === 'fob' ? { operational: true, capacity: definition.capacity, basedFormationIds: [], upgrades: [] } : {}),
      }
      return { ...state, playerAssets: [...state.playerAssets, asset] }
    },
  })),
]

export function economyQuotesFor(state: MatchState, target: EconomyTarget): EconomyActionQuote[] {
  return ACTIONS.flatMap(action => action.quote(state, target) ?? [])
}

export function economyAttentionTargets(state: MatchState): EconomyTarget[] {
  const targets: EconomyTarget[] = [
    ...state.squadrons.map(squadron => ({ kind: 'squadron' as const, id: squadron.id })),
    ...state.playerAssets.filter(asset => ['radar', 'sam', 'aaa'].includes(asset.kind) || asset.kind === 'fob' && asset.operational === false).map(asset => ({ kind: 'asset' as const, id: asset.id })),
  ]
  return targets.filter(target => economyQuotesFor(state, target).some(quote => quote.id === 'repair-formation' || quote.id === 'replace-aircraft' || quote.id === 'repair-defense' || quote.id === 'repair-fob'))
}

export function findMatchingEconomyQuote(quotes: EconomyActionQuote[], pending: Pick<EconomyCommand, 'actionId' | 'target'> | undefined) {
  return pending ? quotes.find(item => item.id === pending.actionId && economyTargetsEqual(item.target, pending.target)) : undefined
}

export function economyCommandForQuote(state: MatchState, selected: EconomyActionQuote): EconomyCommand {
  return { actionId: selected.id, target: selected.target, expectedCost: selected.cost, expectedReserveCost: selected.reserveCost ?? 0, expectedLogistics: state.logistics, expectedReserveAircraft: state.replacements }
}

export function executeEconomyCommand(state: MatchState, command: EconomyCommand): MatchState {
  const action = ACTIONS.find(item => item.id === command.actionId)
  const current = action?.quote(state, command.target, command)
  if (!action || !current?.eligible) return state
  if (command.expectedCost !== undefined && command.expectedCost !== current.cost) return state
  if (command.expectedReserveCost !== undefined && command.expectedReserveCost !== (current.reserveCost ?? 0)) return state
  if (command.expectedLogistics !== undefined && command.expectedLogistics !== state.logistics) return state
  if (command.expectedReserveAircraft !== undefined && command.expectedReserveAircraft !== state.replacements) return state
  const mutated = action.apply(state, command.target, command)
  if (!mutated) return state
  const paid = { ...mutated, logistics: state.logistics - current.cost, replacements: state.replacements - (current.reserveCost ?? 0) }
  const entry: LogisticsStatementEntry = { id: `spend-${state.round}-${state.economy.statement.length}`, round: state.round, direction: 'spend', amount: current.cost, label: current.label, source: command.actionId, target: command.target }
  return { ...paid, economy: { ...paid.economy, statement: [...paid.economy.statement, entry] } }
}

export function purchaseEconomyAction(state: MatchState, actionId: EconomyActionId, target: EconomyTarget): MatchState {
  return executeEconomyCommand(state, { actionId, target })
}

export const openAdaptPhase = (state: MatchState): MatchState => state.phase === 'debrief' ? { ...state, phase: 'adapt' } : state
export const beginNextRound = (state: MatchState): MatchState => {
  if (state.phase !== 'adapt') return state
  const playerAssets = normalizeFormationBasing(state.squadrons, state.playerAssets)
  const squadrons = state.squadrons.map(squadron => {
    const field = formationField(playerAssets, squadron.id)
    if (!field || squadron.aircraft <= 0) return { ...squadron, plannedRecoveryFieldId: undefined }
    const trapped = field.kind === 'fob' && field.operational === false
    const origin = [...field.position] as [number, number]
    return { ...squadron, plannedRecoveryFieldId: undefined, status: trapped ? 'trapped' as const : 'rtb' as const, route: [origin], routeIngress: [origin] }
  })
  return { ...state, playerAssets, squadrons, round: state.round + 1, phase: 'plan', lastResult: undefined }
}
