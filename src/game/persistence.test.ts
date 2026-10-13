import { describe, expect, it } from 'vitest'
import { createCampaignDraft, createMatch } from './data'
import { confirmCampaignSetup } from './campaignSetup'
import { normalizeMatch } from './persistence'
import { createScenario, DEBUG_SCENARIOS } from './scenarios'
import type { MatchState, RoundResult } from './types'

function confirmedThreeFormationCampaign(): MatchState {
  const draft = createCampaignDraft(9234)
  const base = draft.playerAssets.find(asset => asset.kind === 'base')!
  const selectedIds = ['viper', 'raven', 'ghost']
  const selectedAssetIds = ['p-base', 'p-radar', 'p-decoy', 'p-sam']
  const confirmed = confirmCampaignSetup({
    ...draft,
    setup: { stage: 'review', selectedFormationIds: selectedIds, selectedAssetIds, placedAssetIds: selectedAssetIds },
  })
  expect(base.id).toBe('p-base')
  return confirmed
}

const result = (round: number): RoundResult => ({
  round, duration: 60, tickSeconds: 0.05, unitTracks: [], contactIntervals: [], behaviorIntervals: [], events: [],
  squadrons: [], assets: [], enemyLosses: 0, friendlyLosses: 0, friendlyAttrition: [], enemyAttrition: [],
  friendlyFormationsDestroyed: 0, enemyFormationsDestroyed: 0, intelGained: [], baseDamage: 0, enemyBaseDamage: 0,
  logisticsIncome: { base: 6, intel: 0, enemyAircraft: 0, total: 6 }, command: 2, executionRoutes: {}, enemyFlights: [],
  defenseCues: [], defensiveAwareness: 0, lessons: [], playerAssets: [], reinforcementCalls: [], roundScore: 0,
  baseExposure: 4, baseExposureDelta: -2, combatSequences: [], weaponEffects: [], contactObservations: [], interceptPlans: [],
  intelReports: [], mappedAreas: [], discoveredBoundaries: [], recoveryOutcomes: [],
})

describe('normalizeMatch', () => {
  it('round trips a confirmed three-formation campaign and preserves campaign world and logistics', () => {
    const campaign = confirmedThreeFormationCampaign()
    const saved = JSON.parse(JSON.stringify(campaign))
    const loaded = normalizeMatch(saved)
    expect(loaded.phase).toBe('plan')
    expect(loaded.setup).toBeUndefined()
    expect(loaded.squadrons.map(squadron => squadron.id)).toEqual(['viper', 'raven', 'ghost'])
    expect(loaded.seed).toBe(campaign.seed)
    expect(loaded.world).toEqual(campaign.world)
    expect(loaded.round).toBe(campaign.round)
    expect(loaded.logistics).toBe(campaign.logistics)
  })

  it('upgrades a saved one-slot FOB to the current two-formation capacity', () => {
    const campaign = confirmedThreeFormationCampaign()
    const oldFob = { id: 'p-fob-1', kind: 'fob' as const, name: 'FOB ALPHA', position: [0, 0] as [number, number], intel: 'confirmed' as const,
      confidence: 100, health: 100, maxHealth: 100, hidden: false, struck: false, operational: true, capacity: 1, basedFormationIds: ['raven'] }
    const loaded = normalizeMatch(JSON.parse(JSON.stringify({ ...campaign, playerAssets: [...campaign.playerAssets, oldFob] })))
    expect(loaded.playerAssets.find(asset => asset.id === oldFob.id)).toMatchObject({ capacity: 2, basedFormationIds: ['raven'] })
  })

  it('preserves round progression, mission, intelligence, exposure, base damage, and the economy ledger', () => {
    const campaign = confirmedThreeFormationCampaign()
    const damaged = {
      ...campaign, round: 4, phase: 'adapt' as const, baseExposure: 57, lastResult: result(4),
      playerBaseHealth: 23, enemyBaseHealth: 41,
      playerAssets: campaign.playerAssets.map(asset => asset.kind === 'base' ? { ...asset, health: 23, operational: false } : asset),
      squadrons: campaign.squadrons.map(squadron => squadron.id === 'viper' ? { ...squadron, mission: 'base-strike' as const } : squadron),
      economy: { lastSettledRound: 3, statement: [{ id: 'income-3', round: 3, direction: 'income' as const, amount: 8, label: 'ROUND INCOME', source: 'round-resolution' }] },
      mappedAreas: [[2, 3] as [number, number]],
      enemyAssets: campaign.enemyAssets.map(asset => asset.id === 'e-radar' ? { ...asset, intel: 'confirmed' as const, confidence: 100, hidden: false } : asset).map(asset => asset.kind === 'base' ? { ...asset, health: 41 } : asset),
    }
    const loaded = normalizeMatch(JSON.parse(JSON.stringify(damaged)))
    expect(loaded.round).toBe(4)
    expect(loaded.squadrons[0].mission).toBe('base-strike')
    expect(loaded.enemyAssets.find(asset => asset.id === 'e-radar')).toMatchObject({ intel: 'confirmed', hidden: false })
    expect(loaded.baseExposure).toBe(57)
    expect(loaded.playerBaseHealth).toBe(23)
    expect(loaded.enemyBaseHealth).toBe(41)
    expect(loaded.playerAssets.find(asset => asset.kind === 'base')).toMatchObject({ health: 23, operational: false })
    expect(loaded.economy).toEqual(damaged.economy)
  })

  it.each(['victory', 'defeat'] as const)('keeps a final %s state and its result', phase => {
    const campaign = confirmedThreeFormationCampaign()
    const final = { ...campaign, phase, lastResult: result(campaign.round),
      playerBaseHealth: phase === 'defeat' ? 0 : campaign.playerBaseHealth,
      enemyBaseHealth: phase === 'victory' ? 0 : campaign.enemyBaseHealth,
      playerAssets: campaign.playerAssets.map(asset => asset.kind === 'base' && phase === 'defeat' ? { ...asset, health: 0 } : asset),
      enemyAssets: campaign.enemyAssets.map(asset => asset.kind === 'base' && phase === 'victory' ? { ...asset, health: 0 } : asset) }
    const loaded = normalizeMatch(JSON.parse(JSON.stringify(final)))
    expect(loaded.phase).toBe(phase)
    expect(loaded.lastResult).toEqual(final.lastResult)
    expect(loaded.enemyBaseHealth).toBe(final.enemyBaseHealth)
  })

  it('rejects a terminal save without a settled result or a matching outcome', () => {
    const campaign = confirmedThreeFormationCampaign()
    expect(normalizeMatch({ ...campaign, phase: 'victory', lastResult: undefined }).phase).toBe('deploy')
    expect(normalizeMatch({ ...campaign, phase: 'defeat', lastResult: result(campaign.round) }).phase).toBe('deploy')
  })

  it('restores Execute at Plan and clears only the in-progress result', () => {
    const campaign = confirmedThreeFormationCampaign()
    const executing = { ...campaign, phase: 'execute' as const, lastResult: result(campaign.round) }
    const loaded = normalizeMatch(JSON.parse(JSON.stringify(executing)))
    expect(loaded.phase).toBe('plan')
    expect(loaded.lastResult).toBeUndefined()
    expect(loaded.squadrons).toHaveLength(3)
  })

  it('rejects a damaged debrief record before the UI reads its event history', () => {
    const campaign = confirmedThreeFormationCampaign()
    const corrupted = { ...campaign, phase: 'debrief', lastResult: { ...result(campaign.round), events: [null] } }
    expect(normalizeMatch(corrupted).phase).toBe('deploy')
    const badTrack = { ...campaign, phase: 'debrief', lastResult: { ...result(campaign.round), unitTracks: [{ unitId: 'viper', frames: [null] }] } }
    expect(normalizeMatch(badTrack).phase).toBe('deploy')
    const badCombat = { ...campaign, phase: 'debrief', lastResult: { ...result(campaign.round), combatSequences: [{ kind: 'dogfight' }] } }
    expect(normalizeMatch(badCombat).phase).toBe('deploy')
  })

  it('accepts a valid four-formation deployment draft and debug subset', () => {
    const draft = createCampaignDraft(18)
    expect(normalizeMatch(JSON.parse(JSON.stringify(draft))).setup).toEqual(draft.setup)
    const debug = { ...createMatch(18), debugScenario: 'fighter-duel' as const,
      squadrons: createMatch(18).squadrons.slice(0, 1), selectedId: 'viper' }
    expect(normalizeMatch(JSON.parse(JSON.stringify(debug))).squadrons).toHaveLength(1)
  })

  it('round trips every deterministic debug fixture', () => {
    for (const scenario of DEBUG_SCENARIOS) {
      const fixture = createScenario(scenario)
      expect(normalizeMatch(JSON.parse(JSON.stringify(fixture))).debugScenario).toBe(scenario)
    }
  })

  it.each([
    null,
    [],
    { ...createMatch(), seed: Number.NaN },
    { ...createMatch(), squadrons: [{ ...createMatch().squadrons[0], route: [[0, Infinity]] }] },
    { ...createMatch(), squadrons: [{ ...createMatch().squadrons[0], role: 'bomber' }] },
    { ...createMatch(), squadrons: [createMatch().squadrons[0], createMatch().squadrons[0]] },
    { ...createMatch(), squadrons: [] },
    { ...createMatch(), phase: 'debrief', lastResult: undefined },
    { nonsense: true },
  ])('fails malformed or inconsistent input safely into a fresh draft', input => {
    const loaded = normalizeMatch(input)
    expect(loaded.phase).toBe('deploy')
    expect(loaded.setup).toBeDefined()
    expect(loaded.squadrons).toHaveLength(4)
  })
})
