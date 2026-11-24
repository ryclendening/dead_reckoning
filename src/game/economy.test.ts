import { describe, expect, it } from 'vitest'
import { createMatch } from './data'
import { beginNextRound, deriveLogisticsIncome, economyAttentionTargets, economyCommandForQuote, economyQuotesFor, executeEconomyCommand, findMatchingEconomyQuote, LOGISTICS_COSTS, openAdaptPhase, purchaseEconomyAction, settleLogisticsIncome, validateAssetPlacement, validateFobPlacement } from './economy'
import { FORMATION_PRICES } from './economyRules'
import { resolveRound } from './engine'
import { flightRangeFor } from './flightRules'
import { groundAttackDamage } from './strikeRules'
import { effectiveDefenseProfile, radarRange } from './equipmentRules'
import { normalizeMatch } from '../App'
import type { ConstructibleAssetKind, EconomyActionId, IntelReport, MatchState, Point } from './types'

const recoveredReport = (): IntelReport => ({ id: 'intel-1', observerId: 'raven', assetId: 'e-radar', confidence: 90, recovered: true, detail: 'Recovered radar coordinates.' })
const resultFor = (state = createMatch()) => resolveRound(state)

describe('logistics economy', () => {
  it('derives base, intelligence, and uncapped confirmed-aircraft income', () => {
    const state = createMatch()
    const result = { ...resultFor(state), enemyLosses: 5, intelReports: [recoveredReport(), { ...recoveredReport(), id: 'intel-2', assetId: 'e-sam' }] }
    expect(state.logistics).toBe(14)
    expect(state.cpu?.logistics).toBe(14)
    expect(deriveLogisticsIncome(state, result)).toEqual({ base: 8, intel: 4, enemyAircraft: 5, total: 17 })
  })

  it('settles a committed round once and records only the current Adapt statement', () => {
    const state = createMatch()
    const result = { ...resultFor(state), enemyLosses: 2, intelReports: [recoveredReport()], logisticsIncome: { base: 8, intel: 2, enemyAircraft: 2, total: 12 } }
    const once = settleLogisticsIncome(state, result)
    const twice = settleLogisticsIncome(once, result)
    expect(once.logistics).toBe(26)
    expect(twice).toEqual(once)
    expect(once.economy.statement.map(entry => entry.amount)).toEqual([8, 2, 2])
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

  it.each(['fighter','recon'] as const)('buys a complete %s formation at home with cash only and persists it', role => {
    const target = { kind: 'campaign', id: 'campaign' } as const
    const state = { ...createMatch(), phase: 'adapt' as const, logistics: FORMATION_PRICES[role], replacements: 0 }
    const quote = economyQuotesFor(state, target).find(item => item.id === `buy-${role}`)!
    const command = economyCommandForQuote(state, quote)
    const purchased = executeEconomyCommand(state, command)
    const formation = purchased.squadrons.at(-1)!
    const home = purchased.playerAssets.find(asset => asset.kind === 'base')!
    expect(formation).toMatchObject({ role, aircraft: 4, strength: 100, sortieOrdered: false, route: [home.position] })
    expect(home.basedFormationIds).toContain(formation.id)
    expect(purchased.logistics).toBe(0)
    expect(purchased.replacements).toBe(0)
    expect(executeEconomyCommand(purchased, command)).toBe(purchased)
    const unfunded = { ...state, logistics: state.logistics - 1 }
    expect(purchaseEconomyAction(unfunded, quote.id, target)).toBe(unfunded)
    const reloaded = normalizeMatch(JSON.parse(JSON.stringify(purchased)))
    expect(reloaded.squadrons.at(-1)).toMatchObject(formation)
    expect(beginNextRound(reloaded).squadrons.at(-1)?.route).toEqual([home.position])
  })

  it('lists repairable damage instead of destroyed formations', () => {
    const state = { ...createMatch(), phase: 'adapt' as const, squadrons: createMatch().squadrons.map(squadron => squadron.id === 'viper' ? { ...squadron, aircraft: 0, strength: 0, status: 'destroyed' as const } : squadron) }
    expect(economyAttentionTargets(state)).not.toContainEqual({ kind: 'squadron', id: 'viper' })
  })

  it('leaves damaged ground equipment and disabled FOBs out of the repair catalog', () => {
    const base = createMatch()
    const fob = { ...base.playerAssets[0], id: 'p-fob-1', kind: 'fob' as const, health: 0, operational: false, basedFormationIds: ['viper'] }
    const state = { ...base, phase: 'adapt' as const, logistics: 20,
      playerAssets: [...base.playerAssets.map(asset => asset.kind === 'base' ? asset : { ...asset, health: 50 }), fob] }
    for (const asset of state.playerAssets.filter(asset => asset.kind !== 'base')) {
      const target = { kind: 'asset' as const, id: asset.id }
      expect(economyQuotesFor(state, target).every(quote => quote.effect.kind === 'upgrade-installation')).toBe(true)
      expect(purchaseEconomyAction(state, 'repair-defense', target)).toBe(state)
      expect(purchaseEconomyAction(state, 'repair-fob', target)).toBe(state)
    }
    expect(economyAttentionTargets(state)).toEqual([])
  })

  it('persists one mutually exclusive airfield upgrade and applies its effect only to later rounds', () => {
    const state = { ...createMatch(), phase: 'adapt' as const, logistics: 12 }
    const upgraded = purchaseEconomyAction(state, 'install-supply-depot', { kind: 'asset', id: 'p-base' })
    expect(upgraded.logistics).toBe(0)
    expect(upgraded.playerAssets.find(asset => asset.id === 'p-base')?.upgrades).toEqual(['supply-depot'])
    expect(economyQuotesFor(upgraded, { kind: 'asset', id: 'p-base' })).toEqual([])
    expect(deriveLogisticsIncome(upgraded, resultFor({ ...upgraded, phase: 'plan' }))).toMatchObject({ base: 10 })
    const loaded = normalizeMatch(JSON.parse(JSON.stringify(upgraded)))
    expect(loaded.playerAssets.find(asset => asset.id === 'p-base')?.upgrades).toEqual(['supply-depot'])
    expect(purchaseEconomyAction(upgraded, 'install-maintenance-wing', { kind: 'asset', id: 'p-base' })).toBe(upgraded)
  })

  it('applies the Maintenance Wing discount to repair quotes', () => {
    const state = { ...createMatch(), phase: 'adapt' as const, logistics: 20 }
    const upgraded = purchaseEconomyAction(state, 'install-maintenance-wing', { kind: 'asset', id: 'p-base' })
    const damaged = { ...upgraded, squadrons: upgraded.squadrons.map(squadron => squadron.id === 'viper' ? { ...squadron, strength: 50, aircraft: 3 } : squadron) }
    expect(economyQuotesFor(damaged, { kind: 'squadron', id: 'viper' }).find(quote => quote.id === 'repair-formation')?.cost).toBe(1)
  })

  it('returns exact effects and resource projections and omits irrelevant healthy actions', () => {
    const healthy = { ...createMatch(), phase: 'adapt' as const }
    expect(economyQuotesFor(healthy, { kind: 'squadron', id: 'viper' }).map(quote => quote.upgradeId)).toEqual(['extended-tanks', 'precision-ordnance'])
    expect(economyQuotesFor(healthy, { kind: 'asset', id: 'p-radar' }).map(quote => quote.upgradeId)).toEqual(['wide-scan', 'fire-control'])

    const damaged = { ...healthy, logistics: 7, squadrons: healthy.squadrons.map(formation =>
      formation.id === 'viper' ? { ...formation, strength: 88 } : formation) }
    expect(economyQuotesFor(damaged, { kind: 'squadron', id: 'viper' })[0]).toMatchObject({
      detail: 'Strength 88 → 100 (+12).',
      effect: { kind: 'formation-strength', before: 88, after: 100 },
      projected: { logistics: 5, reserveAircraft: 3 },
    })
  })

  it('installs one surviving unit refit, persists it, and applies it to authoritative stats', () => {
    const initial = { ...createMatch(), phase: 'adapt' as const, logistics: 40 }
    const radar = { kind: 'asset', id: 'p-radar' } as const
    const fighter = { kind: 'squadron', id: 'viper' } as const
    const recon = { kind: 'squadron', id: 'raven' } as const
    const battery = { kind: 'asset', id: 'p-sam' } as const
    let state = purchaseEconomyAction(initial, 'install-wide-scan', radar)
    expect(radarRange(state.playerAssets.find(asset => asset.id === radar.id)!)).toBe(8)
    expect(purchaseEconomyAction(state, 'install-fire-control', radar)).toBe(state)
    expect(purchaseEconomyAction(state, 'install-precision-ordnance', recon)).toBe(state)
    state = purchaseEconomyAction(state, 'install-precision-ordnance', fighter)
    state = purchaseEconomyAction(state, 'install-extended-tanks', recon)
    state = purchaseEconomyAction(state, 'install-sam-magazine', battery)
    expect(state.logistics).toBe(8)
    const loaded = normalizeMatch(JSON.parse(JSON.stringify(state)))
    const loadedFighter = loaded.squadrons.find(unit => unit.id === fighter.id)!
    const loadedRecon = loaded.squadrons.find(unit => unit.id === recon.id)!
    expect(groundAttackDamage(loadedFighter, 'sam', 100)).toBe(55)
    expect(groundAttackDamage(loadedFighter, 'base', 100)).toBe(40)
    expect(flightRangeFor(loadedRecon)).toBeCloseTo(64 * 1.2)
    expect(effectiveDefenseProfile(loaded.playerAssets.find(asset => asset.id === battery.id)!, loaded.playerAssets)?.magazine).toBe(4)
    expect(purchaseEconomyAction(loaded, 'install-extended-tanks', fighter)).toBe(loaded)
  })

  it('rejects insufficient, stale, and retargeted commands without mutation', () => {
    const initial = createMatch()
    const damaged = { ...initial, phase: 'adapt' as const, logistics: 1, squadrons: initial.squadrons.map(formation =>
      formation.id === 'viper' ? { ...formation, strength: 88 } : formation) }
    const target = { kind: 'squadron' as const, id: 'viper' }
    expect(purchaseEconomyAction(damaged, 'repair-formation', target)).toBe(damaged)

    const affordable = { ...damaged, logistics: 4 }
    const quote = economyQuotesFor(affordable, target)[0]
    const staleCommand = economyCommandForQuote(affordable, quote)
    const changed = { ...affordable, logistics: 3 }
    expect(executeEconomyCommand(changed, staleCommand)).toBe(changed)
    const assetQuotes = economyQuotesFor(affordable, { kind: 'asset', id: 'p-base' })
    expect(findMatchingEconomyQuote(assetQuotes, staleCommand)).toBeUndefined()
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
    expect(quote).toMatchObject({ cost: LOGISTICS_COSTS.fobConstruction, projected: { logistics: 2 }, effect: { kind: 'asset-construction', assetKind: 'fob', capacity: 2 } })
    expect(executeEconomyCommand(state, economyCommandForQuote(state, quote))).toBe(state)

    const command = { ...economyCommandForQuote(state, quote), placement }
    const built = executeEconomyCommand(state, command)
    expect(built.logistics).toBe(2)
    expect(built.playerAssets.at(-1)).toMatchObject({ id: 'p-fob-1', kind: 'fob', name: 'FOB ALPHA', position: placement, operational: true, capacity: 2, basedFormationIds: [] })
    expect(built.economy.statement.at(-1)).toMatchObject({ direction: 'spend', amount: 8, source: 'build-fob', target: { kind: 'campaign', id: 'campaign' } })
    expect(normalizeMatch(JSON.parse(JSON.stringify(built))).playerAssets.at(-1)).toMatchObject({ kind: 'fob', capacity: 2, operational: true })
    const fundedBuilt = { ...built, logistics: 10 }
    expect(executeEconomyCommand(fundedBuilt, { actionId: 'build-fob', target: { kind: 'campaign', id: 'campaign' }, placement })).toBe(fundedBuilt)
  })

  it.each([
    ['build-decoy', 'decoy', LOGISTICS_COSTS.decoyConstruction, 60],
    ['build-aaa', 'aaa', LOGISTICS_COSTS.aaaConstruction, 100],
    ['build-sam', 'sam', LOGISTICS_COSTS.samConstruction, 100],
    ['build-radar', 'radar', LOGISTICS_COSTS.radarConstruction, 100],
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

  it.each([['radar', 2], ['sam', 3]] as const)('limits each side to %s deployments with replacements after losses', (kind, limit) => {
    const initial = createMatch()
    const target = { kind: 'campaign', id: 'campaign' } as const
    const opening = initial.playerAssets.find(asset => asset.kind === kind)!
    const extras = Array.from({ length: limit - 1 }, (_, index) => ({
      ...opening, id: `p-${kind}-${index + 2}`, position: [99 + index, 99] as Point,
    }))
    const state = { ...initial, phase: 'adapt' as const, logistics: 100, playerAssets: [...initial.playerAssets, ...extras] }
    const actionId = `build-${kind}` as const
    const deploymentQuote = (match: MatchState) => economyQuotesFor(match, target).find(quote => quote.id === actionId)
    expect(deploymentQuote(state)).toMatchObject({
      eligible: false, effect: { deployment: { active: limit, limit } },
    })
    const afterLoss = { ...state, playerAssets: state.playerAssets.map(asset => asset.id === opening.id ? { ...asset, health: 0 } : asset) }
    expect(deploymentQuote(afterLoss)).toMatchObject({
      eligible: true, effect: { deployment: { active: limit - 1, limit } },
    })
    const [x,z] = state.world.friendlyTerritory.center
    const placement: Point = [x, z - 4]
    expect(executeEconomyCommand(state, { actionId, target, placement })).toBe(state)
    const replaced = executeEconomyCommand(afterLoss, { actionId, target, placement })
    expect(replaced.playerAssets.at(-1)).toMatchObject({ id: `p-${kind}-${limit + 1}`, position: placement })
    expect(deploymentQuote(replaced)).toMatchObject({
      eligible: false, effect: { deployment: { active: limit, limit } },
    })
  })

  it('blocks overlapping enemy territory without consulting unrelated enemy infrastructure', () => {
    const state = { ...createMatch(), phase: 'adapt' as const }
    const center = state.world.friendlyTerritory.center
    const placement = Array.from({ length: 17 }, (_, x) => Array.from({ length: 17 }, (_, z) => [center[0] - 4 + x * .5, center[1] - 4 + z * .5] as Point)).flat().find(point => validateFobPlacement(state, point).valid)!
    const hiddenOverlap = { ...state, enemyAssets: state.enemyAssets.map((asset, index) => index ? asset : { ...asset, position: placement }) }
    expect(validateFobPlacement(hiddenOverlap, placement)).toEqual({ valid: false, reason: 'SITE MUST BE OUTSIDE ENEMY TERRITORY' })
    const remoteBase = { ...state, enemyAssets: state.enemyAssets.map(asset => asset.kind === 'sam' ? { ...asset, position: placement } : asset) }
    expect(validateFobPlacement(remoteBase, placement)).toEqual({ valid: true })
  })

  it('expands construction territory from operational FOBs and removes it when disabled', () => {
    const initial = createMatch()
    const center = initial.world.friendlyTerritory.center
    const fob = { id: 'p-fob-test', kind: 'fob' as const, position: [center[0] + 5.5, center[1]] as Point, intel: 'confirmed' as const, confidence: 100, health: 100, maxHealth: 100, hidden: false, struck: false, operational: true, capacity: 1, basedFormationIds: [] }
    const expanded = { ...initial, phase: 'adapt' as const, playerAssets: [...initial.playerAssets, fob] }
    const beyondHome = [center[0] + 7.8, center[1]] as Point
    expect(validateFobPlacement(expanded, beyondHome)).toEqual({ valid: true })
    const disabled = { ...expanded, playerAssets: expanded.playerAssets.map(asset => asset.id === fob.id ? { ...asset, operational: false } : asset) }
    expect(validateFobPlacement(disabled, beyondHome)).toMatchObject({ valid: false, reason: 'SITE MUST BE IN RECOVERED TERRITORY' })
  })
})
