import { describe, expect, it } from 'vitest'
import { createMatch } from './data'
import { beginNextRound, deriveLogisticsIncome, economyAttentionTargets, economyCommandForQuote, economyQuotesFor, executeEconomyCommand, findMatchingEconomyQuote, LOGISTICS_COSTS, openAdaptPhase, purchaseEconomyAction, settleLogisticsIncome, validateAssetPlacement, validateFobPlacement } from './economy'
import { resolveRound } from './engine'
import { normalizeMatch } from '../App'
import type { ConstructibleAssetKind, EconomyActionId, IntelReport, Point } from './types'

const recoveredReport = (): IntelReport => ({ id: 'intel-1', observerId: 'raven', assetId: 'e-radar', confidence: 90, recovered: true, detail: 'Recovered radar coordinates.' })
const resultFor = (state = createMatch()) => resolveRound(state)

describe('logistics economy', () => {
  it('derives base, intelligence, and uncapped confirmed-aircraft income', () => {
    const state = createMatch()
    const result = { ...resultFor(state), enemyLosses: 5, intelReports: [recoveredReport(), { ...recoveredReport(), id: 'intel-2', assetId: 'e-sam' }] }
    expect(deriveLogisticsIncome(state, result)).toEqual({ base: 6, intel: 4, enemyAircraft: 5, total: 15 })
  })

  it('settles a committed round once and records only the current Adapt statement', () => {
    const state = createMatch()
    const result = { ...resultFor(state), enemyLosses: 2, intelReports: [recoveredReport()], logisticsIncome: { base: 6, intel: 2, enemyAircraft: 2, total: 10 } }
    const once = settleLogisticsIncome(state, result)
    const twice = settleLogisticsIncome(once, result)
    expect(once.logistics).toBe(20)
    expect(twice).toEqual(once)
    expect(once.economy.statement.map(entry => entry.amount)).toEqual([6, 2, 2])
  })

  it('repairs formation condition only during Adapt and never exceeds aircraft-supported strength', () => {
    const state = { ...createMatch(), phase: 'adapt' as const, logistics: 10, squadrons: createMatch().squadrons.map(squadron => squadron.id === 'viper' ? { ...squadron, strength: 55 } : squadron) }
    const repaired = purchaseEconomyAction(state, 'repair-formation', { kind: 'squadron', id: 'viper' })
    expect(repaired.logistics).toBe(8)
    expect(repaired.squadrons.find(squadron => squadron.id === 'viper')?.strength).toBe(80)
    const second = purchaseEconomyAction(repaired, 'repair-formation', { kind: 'squadron', id: 'viper' })
    expect(second.squadrons.find(squadron => squadron.id === 'viper')?.strength).toBe(100)
    expect(purchaseEconomyAction({ ...state, phase: 'plan' }, 'repair-formation', { kind: 'squadron', id: 'viper' })).toEqual({ ...state, phase: 'plan' })

    const reduced = { ...state, squadrons: state.squadrons.map(squadron => squadron.id === 'viper' ? { ...squadron, aircraft: 2, strength: 30 } : squadron) }
    const capped = purchaseEconomyAction(reduced, 'repair-formation', { kind: 'squadron', id: 'viper' })
    expect(capped.squadrons.find(squadron => squadron.id === 'viper')?.strength).toBe(50)
  })

  it('replaces a destroyed aircraft only when both Logistics and reserve inventory are available', () => {
    const state = { ...createMatch(), phase: 'adapt' as const, logistics: 4, replacements: 1, squadrons: createMatch().squadrons.map(squadron => squadron.id === 'viper' ? { ...squadron, aircraft: 0, strength: 0, status: 'destroyed' as const } : squadron) }
    const replaced = purchaseEconomyAction(state, 'replace-aircraft', { kind: 'squadron', id: 'viper' })
    expect(replaced.logistics).toBe(0)
    expect(replaced.replacements).toBe(0)
    expect(replaced.squadrons.find(squadron => squadron.id === 'viper')).toMatchObject({ aircraft: 1, strength: 25, status: 'rtb' })
    expect(purchaseEconomyAction({ ...state, replacements: 0 }, 'replace-aircraft', { kind: 'squadron', id: 'viper' })).toEqual({ ...state, replacements: 0 })
  })

  it('keeps destroyed formations in the contextual Needs Attention queue', () => {
    const state = { ...createMatch(), phase: 'adapt' as const, squadrons: createMatch().squadrons.map(squadron => squadron.id === 'viper' ? { ...squadron, aircraft: 0, strength: 0, status: 'destroyed' as const } : squadron) }
    expect(economyAttentionTargets(state)).toContainEqual({ kind: 'squadron', id: 'viper' })
  })

  it('repairs valid defense assets and rejects invalid asset targets', () => {
    const state = { ...createMatch(), phase: 'adapt' as const, logistics: 2, playerAssets: createMatch().playerAssets.map(asset => asset.id === 'p-radar' ? { ...asset, health: 60 } : asset) }
    const repaired = purchaseEconomyAction(state, 'repair-defense', { kind: 'asset', id: 'p-radar' })
    expect(repaired.playerAssets.find(asset => asset.id === 'p-radar')?.health).toBe(85)
    expect(economyQuotesFor(state, { kind: 'asset', id: 'p-decoy' })).toEqual([])

    const nearlyHealthy = { ...state, playerAssets: state.playerAssets.map(asset => asset.id === 'p-radar' ? { ...asset, health: 90 } : asset) }
    expect(purchaseEconomyAction(nearlyHealthy, 'repair-defense', { kind: 'asset', id: 'p-radar' }).playerAssets.find(asset => asset.id === 'p-radar')?.health).toBe(100)
  })

  it('repairs an unusable FOB for four Logistics and releases trapped formations', () => {
    const base = createMatch()
    const state = { ...base, phase: 'adapt' as const, logistics: 6, playerAssets: [...base.playerAssets, { id: 'p-fob-1', kind: 'fob' as const, name: 'FOB ALPHA', position: [0, 0] as Point, intel: 'confirmed' as const, confidence: 100, health: 0, maxHealth: 100, hidden: false, struck: false, operational: false, capacity: 1, basedFormationIds: ['viper'] }], squadrons: base.squadrons.map(squadron => squadron.id === 'viper' ? { ...squadron, status: 'trapped' as const } : squadron) }
    const repaired = purchaseEconomyAction(state, 'repair-fob', { kind: 'asset', id: 'p-fob-1' })
    expect(repaired.logistics).toBe(2)
    expect(repaired.playerAssets.find(asset => asset.id === 'p-fob-1')).toMatchObject({ operational: true, health: 100 })
    expect(repaired.squadrons.find(squadron => squadron.id === 'viper')?.status).toBe('rtb')
  })

  it('persists one mutually exclusive airfield upgrade and applies its effect only to later rounds', () => {
    const state = { ...createMatch(), phase: 'adapt' as const, logistics: 12 }
    const upgraded = purchaseEconomyAction(state, 'install-supply-depot', { kind: 'asset', id: 'p-base' })
    expect(upgraded.logistics).toBe(0)
    expect(upgraded.playerAssets.find(asset => asset.id === 'p-base')?.upgrades).toEqual(['supply-depot'])
    expect(economyQuotesFor(upgraded, { kind: 'asset', id: 'p-base' })).toEqual([])
    expect(deriveLogisticsIncome(upgraded, resultFor({ ...upgraded, phase: 'plan' }))).toMatchObject({ base: 8 })
    const loaded = normalizeMatch(JSON.parse(JSON.stringify(upgraded)))
    expect(loaded.playerAssets.find(asset => asset.id === 'p-base')?.upgrades).toEqual(['supply-depot'])
    expect(purchaseEconomyAction(upgraded, 'install-maintenance-wing', { kind: 'asset', id: 'p-base' })).toBe(upgraded)
  })

  it('applies the Maintenance Wing discount to repair and replacement quotes', () => {
    const state = { ...createMatch(), phase: 'adapt' as const, logistics: 20 }
    const upgraded = purchaseEconomyAction(state, 'install-maintenance-wing', { kind: 'asset', id: 'p-base' })
    const damaged = { ...upgraded, squadrons: upgraded.squadrons.map(squadron => squadron.id === 'viper' ? { ...squadron, strength: 50, aircraft: 3 } : squadron) }
    expect(economyQuotesFor(damaged, { kind: 'squadron', id: 'viper' }).map(quote => quote.cost)).toEqual([1, 3])
  })

  it('returns exact effects and resource projections and omits irrelevant healthy actions', () => {
    const healthy = { ...createMatch(), phase: 'adapt' as const }
    expect(economyQuotesFor(healthy, { kind: 'squadron', id: 'viper' })).toEqual([])
    expect(economyQuotesFor(healthy, { kind: 'asset', id: 'p-radar' })).toEqual([])

    const damaged = { ...healthy, logistics: 7, playerAssets: healthy.playerAssets.map(asset => asset.id === 'p-radar' ? { ...asset, health: 88 } : asset) }
    expect(economyQuotesFor(damaged, { kind: 'asset', id: 'p-radar' })[0]).toMatchObject({
      detail: 'Health 88 → 100 (+12).',
      effect: { kind: 'asset-health', before: 88, after: 100 },
      projected: { logistics: 5, reserveAircraft: 3 },
    })
  })

  it('rejects insufficient, stale, and retargeted commands without mutation', () => {
    const state = { ...createMatch(), phase: 'adapt' as const, logistics: 1, playerAssets: createMatch().playerAssets.map(asset => asset.kind === 'radar' || asset.kind === 'sam' ? { ...asset, health: 50 } : asset) }
    expect(purchaseEconomyAction(state, 'repair-defense', { kind: 'asset', id: 'p-radar' })).toBe(state)

    const affordable = { ...state, logistics: 4 }
    const radarQuote = economyQuotesFor(affordable, { kind: 'asset', id: 'p-radar' })[0]
    const staleCommand = economyCommandForQuote(affordable, radarQuote)
    const changed = { ...affordable, logistics: 3 }
    expect(executeEconomyCommand(changed, staleCommand)).toBe(changed)

    const samQuotes = economyQuotesFor(affordable, { kind: 'asset', id: 'p-sam' })
    expect(findMatchingEconomyQuote(samQuotes, { actionId: radarQuote.id, target: radarQuote.target })).toBeUndefined()
  })

  it('enforces Debrief to Adapt to next-round Plan as the only transition sequence', () => {
    const initial = createMatch()
    const result = resultFor(initial)
    const debrief = { ...initial, phase: 'debrief' as const, lastResult: result }
    expect(openAdaptPhase(initial)).toBe(initial)
    const adapt = openAdaptPhase(debrief)
    expect(adapt.phase).toBe('adapt')
    const next = beginNextRound(adapt)
    expect(next).toMatchObject({ phase: 'plan', round: 2, lastResult: undefined })
    expect(beginNextRound(debrief)).toBe(debrief)
  })

  it('constructs a persistent FOB atomically at a valid recovered location', () => {
    const state = { ...createMatch(), phase: 'adapt' as const, logistics: 10 }
    const center = state.world.friendlyTerritory.center
    const candidates: Point[] = Array.from({ length: 17 }, (_, x) => Array.from({ length: 17 }, (_, z) => [center[0] - 4 + x * .5, center[1] - 4 + z * .5] as Point)).flat()
    const placement = candidates.find(point => validateFobPlacement(state, point).valid)
    expect(placement).toBeDefined()
    expect(validateFobPlacement(state, [999, 999])).toMatchObject({ valid: false, reason: 'SITE MUST BE IN RECOVERED TERRITORY' })

    const quote = economyQuotesFor(state, { kind: 'campaign', id: 'campaign' }).find(item => item.id === 'build-fob')!
    expect(quote).toMatchObject({ cost: LOGISTICS_COSTS.fobConstruction, projected: { logistics: 2 }, effect: { kind: 'asset-construction', assetKind: 'fob', capacity: 1 } })
    expect(executeEconomyCommand(state, economyCommandForQuote(state, quote))).toBe(state)

    const command = { ...economyCommandForQuote(state, quote), placement }
    const built = executeEconomyCommand(state, command)
    expect(built.logistics).toBe(2)
    expect(built.playerAssets.at(-1)).toMatchObject({ id: 'p-fob-1', kind: 'fob', name: 'FOB ALPHA', position: placement, operational: true, capacity: 1, basedFormationIds: [] })
    expect(built.economy.statement.at(-1)).toMatchObject({ direction: 'spend', amount: 8, source: 'build-fob', target: { kind: 'campaign', id: 'campaign' } })
    expect(normalizeMatch(JSON.parse(JSON.stringify(built))).playerAssets.at(-1)).toMatchObject({ kind: 'fob', capacity: 1, operational: true })
    const fundedBuilt = { ...built, logistics: 10 }
    expect(executeEconomyCommand(fundedBuilt, { actionId: 'build-fob', target: { kind: 'campaign', id: 'campaign' }, placement })).toBe(fundedBuilt)
  })

  it.each([
    ['build-decoy', 'decoy', LOGISTICS_COSTS.decoyConstruction, 60],
    ['build-aaa', 'aaa', LOGISTICS_COSTS.aaaConstruction, 100],
    ['build-sam', 'sam', LOGISTICS_COSTS.samConstruction, 100],
  ] as const)('constructs %s atomically through the shared procurement registry', (actionId, kind, cost, maxHealth) => {
    const state = { ...createMatch(), phase: 'adapt' as const, logistics: 20 }
    const center = state.world.friendlyTerritory.center
    const candidates: Point[] = Array.from({ length: 17 }, (_, x) => Array.from({ length: 17 }, (_, z) => [center[0] - 4 + x * .5, center[1] - 4 + z * .5] as Point)).flat()
    const placement = candidates.find(point => validateAssetPlacement(state, kind as ConstructibleAssetKind, point).valid)!
    const quote = economyQuotesFor(state, { kind: 'campaign', id: 'campaign' }).find(item => item.id === actionId)!
    expect(quote).toMatchObject({ cost, effect: { kind: 'asset-construction', assetKind: kind }, projected: { logistics: 20 - cost } })
    expect(executeEconomyCommand(state, economyCommandForQuote(state, quote))).toBe(state)
    const built = executeEconomyCommand(state, { ...economyCommandForQuote(state, quote), placement })
    expect(built.logistics).toBe(20 - cost)
    expect(built.playerAssets.at(-1)).toMatchObject({ id: `p-${kind}-2`, kind, position: placement, health: maxHealth, maxHealth })
    expect(built.economy.statement.at(-1)).toMatchObject({ amount: cost, source: actionId })
    expect(executeEconomyCommand({ ...state, phase: 'plan' }, { actionId: actionId as EconomyActionId, target: { kind: 'campaign', id: 'campaign' }, placement })).toEqual({ ...state, phase: 'plan' })
  })

  it('validates FOB placement from persistent knowledge without consulting hidden enemy truth', () => {
    const state = { ...createMatch(), phase: 'adapt' as const }
    const center = state.world.friendlyTerritory.center
    const placement = Array.from({ length: 17 }, (_, x) => Array.from({ length: 17 }, (_, z) => [center[0] - 4 + x * .5, center[1] - 4 + z * .5] as Point)).flat().find(point => validateFobPlacement(state, point).valid)!
    const hiddenOverlap = { ...state, enemyAssets: state.enemyAssets.map((asset, index) => index ? asset : { ...asset, position: placement }) }
    expect(validateFobPlacement(hiddenOverlap, placement)).toEqual({ valid: true })
  })
})
