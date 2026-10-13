import { createCampaignDraft, createMatch } from './data'
import { campaignOutcome } from './campaign'
import { createEconomyState } from './economy'
import { normalizeFormationBasing } from './forwardBasing'
import type { Asset, CampaignSetupState, DebugScenario, EconomyState, MatchState, MissionId, Point, RoundResult, Squadron } from './types'
import { DEBUG_SCENARIOS } from './scenarios'

const phases = new Set(['deploy', 'plan', 'execute', 'debrief', 'adapt', 'victory', 'defeat'])
const roles = new Set(['fighter', 'recon'])
const missions = new Set(['defensive-cap', 'forward-patrol', 'transit', 'search-area', 'base-strike'])
const assetKinds = new Set(['base', 'fob', 'decoy', 'radar', 'sam', 'aaa'])
const intelLevels = new Set(['unknown', 'suspected', 'probable', 'confirmed'])
const setupStages = new Set(['allocate', 'place', 'review'])
const upgrades = new Set(['maintenance-wing', 'supply-depot'])

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const nonnegative = (value: unknown): value is number => finite(value) && value >= 0
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0
const point = (value: unknown): value is Point => Array.isArray(value) && value.length === 2 && finite(value[0]) && finite(value[1])
const points = (value: unknown): value is Point[] => Array.isArray(value) && value.every(point)
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(text)

function finiteTree(value: unknown, seen = new Set<object>()): boolean {
  if (typeof value === 'number') return Number.isFinite(value)
  if (value === null || typeof value !== 'object') return true
  if (seen.has(value)) return false
  seen.add(value)
  const valid = Array.isArray(value)
    ? value.every(item => finiteTree(item, seen))
    : Object.values(value).every(item => finiteTree(item, seen))
  seen.delete(value)
  return valid
}

function validWorld(value: unknown): boolean {
  if (!record(value) || !record(value.bounds) || !record(value.presentationBounds) || !record(value.friendlyTerritory)) return false
  const bounds = value.bounds
  const presentation = value.presentationBounds
  const territory = value.friendlyTerritory
  return finite(value.seed) && text(value.startRegionId)
    && [bounds.minX, bounds.maxX, bounds.minZ, bounds.maxZ, presentation.minX, presentation.maxX, presentation.minZ, presentation.maxZ].every(finite)
    && finite(bounds.minX) && finite(bounds.maxX) && finite(bounds.minZ) && finite(bounds.maxZ)
    && bounds.minX < bounds.maxX && bounds.minZ < bounds.maxZ
    && point(territory.center) && finite(territory.radius) && territory.radius > 0
    && (territory.regions === undefined || Array.isArray(territory.regions) && territory.regions.every(region =>
      record(region) && text(region.id) && (region.kind === 'home' || region.kind === 'fob') && point(region.center) && finite(region.radius) && region.radius > 0))
}

function validSquadron(value: unknown): value is Squadron {
  if (!record(value) || !text(value.id) || !text(value.callsign) || !roles.has(String(value.role))) return false
  if (!missions.has(String(value.mission)) || !Number.isInteger(value.aircraft) || !nonnegative(value.aircraft)
      || !Number.isInteger(value.maxAircraft) || !finite(value.maxAircraft) || value.maxAircraft < 1 || value.aircraft > value.maxAircraft
      || !Number.isInteger(value.damaged) || !nonnegative(value.damaged) || value.damaged > value.aircraft
      || !finite(value.readiness) || value.readiness < 0 || value.readiness > 100
      || !finite(value.ammo) || value.ammo < 0 || value.ammo > 100
      || !points(value.route) || !points(value.routeIngress)) return false
  if (value.strength !== undefined && (!finite(value.strength) || value.strength < 0 || value.strength > 100)) return false
  if (value.morale !== undefined && (!finite(value.morale) || value.morale < 0 || value.morale > 100)) return false
  if (value.status !== undefined && !new Set(['enroute', 'dogfight', 'disengaging', 'rtb', 'trapped', 'destroyed']).has(String(value.status))) return false
  if (value.plannedRecoveryFieldId !== undefined && !text(value.plannedRecoveryFieldId)) return false
  if (value.sortieOrdered !== undefined && typeof value.sortieOrdered !== 'boolean') return false
  return value.role === 'fighter' ? value.mission !== 'search-area' : value.mission === 'search-area'
}

function validAsset(value: unknown): value is Asset {
  if (!record(value) || !text(value.id) || !assetKinds.has(String(value.kind)) || !point(value.position)
      || !intelLevels.has(String(value.intel)) || !finite(value.confidence) || value.confidence < 0 || value.confidence > 100
      || !nonnegative(value.health) || !finite(value.maxHealth) || value.maxHealth <= 0 || value.health > value.maxHealth
      || typeof value.hidden !== 'boolean' || typeof value.struck !== 'boolean') return false
  if (value.operational !== undefined && typeof value.operational !== 'boolean') return false
  if (value.capacity !== undefined && (!Number.isInteger(value.capacity) || !finite(value.capacity) || value.capacity < 1)) return false
  if (value.basedFormationIds !== undefined && !strings(value.basedFormationIds)) return false
  if (value.upgrades !== undefined && (!Array.isArray(value.upgrades) || value.upgrades.some(item => !upgrades.has(String(item))))) return false
  if (value.name !== undefined && typeof value.name !== 'string') return false
  return true
}

function validEconomy(value: unknown): value is EconomyState {
  if (!record(value) || !Array.isArray(value.statement)) return false
  if (value.lastSettledRound !== undefined && (!Number.isInteger(value.lastSettledRound) || !nonnegative(value.lastSettledRound))) return false
  return value.statement.every(entry => record(entry) && text(entry.id) && Number.isInteger(entry.round) && nonnegative(entry.round)
    && (entry.direction === 'income' || entry.direction === 'spend') && finite(entry.amount) && entry.amount >= 0
    && text(entry.label) && text(entry.source))
}

function validSetup(value: unknown, squadronIds: Set<string>, assetIds: Set<string>): value is CampaignSetupState {
  if (!record(value) || !strings(value.selectedAssetIds)) return false
  const selectedAssetIds = value.selectedAssetIds
  return setupStages.has(String(value.stage)) && strings(value.selectedFormationIds)
    && strings(value.placedAssetIds) && new Set(value.selectedFormationIds).size === value.selectedFormationIds.length
    && new Set(value.selectedAssetIds).size === value.selectedAssetIds.length && new Set(value.placedAssetIds).size === value.placedAssetIds.length
    && value.selectedFormationIds.every(id => squadronIds.has(id)) && value.selectedAssetIds.every(id => assetIds.has(id))
    && value.placedAssetIds.every(id => selectedAssetIds.includes(id))
}

function validResult(value: unknown): value is RoundResult {
  if (!record(value)) return false
  const r = value as unknown as RoundResult
  return Number.isInteger(r.round) && nonnegative(r.round) && finite(r.duration) && r.duration >= 0
    && finite(r.tickSeconds) && r.tickSeconds > 0
    && ['unitTracks', 'contactIntervals', 'behaviorIntervals', 'events', 'squadrons', 'assets', 'friendlyAttrition',
      'enemyAttrition', 'intelGained', 'enemyFlights', 'defenseCues', 'lessons', 'playerAssets',
      'reinforcementCalls', 'combatSequences', 'weaponEffects', 'contactObservations', 'interceptPlans', 'intelReports',
      'mappedAreas', 'discoveredBoundaries', 'recoveryOutcomes'].every(key => Array.isArray(value[key]))
    && record(r.logisticsIncome) && finite(r.logisticsIncome.total)
    && finite(r.baseExposure) && finite(r.baseExposureDelta)
    && r.events.every(item => record(item) && text(item.id) && finite(item.time) && text(item.title)
      && typeof item.detail === 'string' && ['info', 'friendly', 'warning', 'danger'].includes(String(item.tone))
      && (item.position === undefined || point(item.position)))
    && r.squadrons.every(validSquadron) && r.assets.every(validAsset) && r.playerAssets.every(validAsset)
    && [...r.friendlyAttrition, ...r.enemyAttrition].every(item => record(item) && text(item.id)
      && text(item.callsign) && finite(item.aircraftLost) && finite(item.startAircraft)
      && finite(item.endAircraft) && finite(item.endStrength) && typeof item.destroyed === 'boolean'
      && typeof item.confirmed === 'boolean' && text(item.finalStatus))
    && r.intelReports.every(item => record(item) && text(item.id) && text(item.assetId)
      && text(item.observerId) && typeof item.recovered === 'boolean' && typeof item.detail === 'string')
    && record(r.executionRoutes) && Object.values(r.executionRoutes).every(points) && points(r.mappedAreas)
    && r.unitTracks.every(item => record(item) && text(item.unitId) && Array.isArray(item.frames)
      && item.frames.every(frame => record(frame) && finite(frame.time) && point(frame.position)
        && point(frame.facing) && finite(frame.strength) && finite(frame.morale)
        && finite(frame.aircraft) && finite(frame.traveledDistance) && text(frame.mode)))
    && r.enemyFlights.every(item => record(item) && text(item.id) && text(item.callsign)
      && points(item.route) && Array.isArray(item.detectionWindows)
      && item.detectionWindows.every(window => record(window) && finite(window.start) && finite(window.end)
        && ['radar', 'visual'].includes(String(window.source))))
    && r.contactIntervals.every(item => record(item) && text(item.id) && text(item.observerId)
      && text(item.targetId) && finite(item.start) && finite(item.end) && point(item.position))
    && r.weaponEffects.every(item => record(item) && text(item.id) && text(item.sourceId)
      && text(item.targetId) && finite(item.start) && finite(item.end) && point(item.from)
      && point(item.to) && typeof item.hit === 'boolean' && finite(item.damage))
    && r.combatSequences.every(sequence => record(sequence) && text(sequence.id)
      && ['dogfight', 'pursuit', 'strike', 'defense'].includes(String(sequence.kind))
      && strings(sequence.participantIds) && point(sequence.location)
      && finite(sequence.start) && finite(sequence.end) && sequence.end >= sequence.start
      && Array.isArray(sequence.exchanges) && sequence.exchanges.every(exchange =>
        record(exchange) && text(exchange.id) && finite(exchange.time)
        && text(exchange.attackerId) && text(exchange.defenderId)
        && ['air-to-air-missile', 'air-to-ground-missile', 'sam', 'aaa', 'gun'].includes(String(exchange.weapon))
        && finite(exchange.damage) && finite(exchange.moraleDamage)
        && typeof exchange.hit === 'boolean' && point(exchange.position)
        && finite(exchange.targetStrength) && finite(exchange.targetMorale))
      && record(sequence.finalDisposition)
      && (sequence.kind !== 'dogfight' || record(sequence.engagement)
        && record(sequence.engagement.sides)
        && strings(sequence.engagement.sides.friendly)
        && strings(sequence.engagement.sides.hostile)
        && Array.isArray(sequence.engagement.participants)
        && Array.isArray(sequence.engagement.phases)
        && Array.isArray(sequence.engagement.positionalAssessments)))
    && ['behaviorIntervals', 'defenseCues', 'lessons', 'reinforcementCalls', 'combatSequences',
      'contactObservations', 'interceptPlans', 'discoveredBoundaries', 'recoveryOutcomes']
      .every(key => (value[key] as unknown[]).every(record))
}

const uniqueAcross = (...groups: string[][]) => {
  const ids = groups.flat()
  return new Set(ids).size === ids.length
}

function fallback(input: Record<string, unknown>): MatchState {
  return createCampaignDraft(finite(input.seed) && Number.isInteger(input.seed) ? input.seed : undefined)
}

/** Validates a persisted campaign shape, then restores the non-serializable execution boundary. */
export function normalizeMatch(input: unknown): MatchState {
  if (!record(input) || !finiteTree(input)) return fallback(record(input) ? input : {})
  const fresh = createMatch(finite(input.seed) && Number.isInteger(input.seed) ? input.seed : undefined)
  if (!Number.isInteger(input.seed) || !finite(input.seed) || !Number.isInteger(input.round) || !nonnegative(input.round)
      || input.round < 1 || !phases.has(String(input.phase)) || !finite(input.logistics) || input.logistics < 0
      || !finite(input.command) || input.command < 0 || !Number.isInteger(input.replacements) || !nonnegative(input.replacements)
      || !finite(input.playerBaseHealth) || input.playerBaseHealth < 0 || input.playerBaseHealth > 100
      || !finite(input.enemyBaseHealth) || input.enemyBaseHealth < 0 || input.enemyBaseHealth > 100
      || !finite(input.baseExposure) || input.baseExposure < 0 || input.baseExposure > 100
      || !finite(input.campaignScore) || !Array.isArray(input.squadrons) || !input.squadrons.every(validSquadron)
      || !Array.isArray(input.enemyAssets) || !input.enemyAssets.every(validAsset)
      || !Array.isArray(input.playerAssets) || !input.playerAssets.every(validAsset)
      || !validWorld(input.world) || !points(input.mappedAreas)
      || !Array.isArray(input.discoveredBoundaries) || !input.discoveredBoundaries.every(segment => record(segment)
        && ['north', 'east', 'south', 'west'].includes(String(segment.edge)) && finite(segment.coordinate) && finite(segment.from) && finite(segment.to) && segment.from <= segment.to)
      || input.debugScenario !== undefined && !DEBUG_SCENARIOS.includes(input.debugScenario as DebugScenario)) return fallback(input)

  const squadrons = input.squadrons as Squadron[]
  const enemyAssets = input.enemyAssets as Asset[]
  const playerAssets = input.playerAssets as Asset[]
  const base = playerAssets.find(asset => asset.kind === 'base')
  const enemyBase = enemyAssets.find(asset => asset.kind === 'base')
  if (!base || !enemyBase || playerAssets.filter(asset => asset.kind === 'base').length !== 1
      || enemyAssets.filter(asset => asset.kind === 'base').length !== 1
      || !uniqueAcross(squadrons.map(item => item.id), enemyAssets.map(item => item.id), playerAssets.map(item => item.id))
      || !text(input.selectedId) || !squadrons.some(squadron => squadron.id === input.selectedId)
      || !squadrons.length) return fallback(input)

  const debugScenario = (input.debugScenario ?? 'campaign') as DebugScenario
  const setup = input.setup
  if (setup !== undefined) {
    const ids = new Set(squadrons.map(squadron => squadron.id))
    const assetIds = new Set(playerAssets.map(asset => asset.id))
    if (debugScenario !== 'campaign' || input.phase !== 'deploy' || squadrons.length !== fresh.squadrons.length
        || !validSetup(setup, ids, assetIds)
        || setup.stage === 'review' && setup.selectedAssetIds.some(id => !setup.placedAssetIds.includes(id))) return fallback(input)
  } else if (input.phase === 'deploy') return fallback(input)
  else if (debugScenario === 'campaign' && squadrons.length !== 3 && squadrons.length !== fresh.squadrons.length) return fallback(input)
  else if (debugScenario === 'campaign' && (!squadrons.some(s => s.role === 'fighter') || !squadrons.some(s => s.role === 'recon'))) return fallback(input)

  if (input.economy !== undefined && !validEconomy(input.economy)) return fallback(input)
  if (input.lastResult !== undefined && !validResult(input.lastResult)) return fallback(input)
  if (input.phase === 'debrief' || input.lastResult !== undefined) {
    if (!validResult(input.lastResult) || input.lastResult.round !== input.round) return fallback(input)
  }
  if (input.phase === 'victory' || input.phase === 'defeat') {
    if (!validResult(input.lastResult)) return fallback(input)
    const outcome = campaignOutcome(input as unknown as MatchState)
    if (input.phase === 'victory' ? outcome !== 'enemy-base-destroyed' : !outcome || outcome === 'enemy-base-destroyed') return fallback(input)
  }

  const normalizedSquadrons = squadrons.map(squadron => {
    const routeIngress = squadron.routeIngress.length ? squadron.routeIngress : squadron.route
    return {
      ...squadron,
      routeIngress,
      mission: (squadron.role === 'recon' ? 'search-area' : squadron.mission) as MissionId,
      strength: squadron.strength ?? Math.max(0, Math.min(100, squadron.aircraft / Math.max(1, squadron.maxAircraft) * 100)),
      morale: squadron.morale ?? Math.round(48 + squadron.readiness * 0.42),
      status: squadron.status ?? 'enroute' as const,
    }
  })
  const normalizedAssets = playerAssets.map(asset => {
    if (asset.kind === 'base') return { ...asset, operational: asset.operational ?? asset.health > 0, upgrades: asset.upgrades ?? [] }
    if (asset.kind === 'fob') return { ...asset, operational: asset.operational !== false, capacity: asset.capacity ?? 1, basedFormationIds: asset.basedFormationIds ?? [] }
    return asset
  })
  const basedAssets = normalizeFormationBasing(normalizedSquadrons, normalizedAssets)
  // MatchState duplicates this value for campaign rules; the asset is authoritative.
  const savedBase = normalizedAssets.find(asset => asset.kind === 'base')!
  const synchronizedAssets = basedAssets.map(asset => asset.kind === 'base'
    ? { ...asset, operational: savedBase.operational ?? asset.health > 0 }
    : asset)
  const phase = input.phase === 'execute' ? 'plan' : input.phase
  return {
    ...fresh,
    ...input,
    world: input.world as MatchState['world'],
    mappedAreas: input.mappedAreas,
    discoveredBoundaries: input.discoveredBoundaries as MatchState['discoveredBoundaries'],
    phase: phase as MatchState['phase'],
    squadrons: normalizedSquadrons,
    enemyAssets,
    playerAssets: synchronizedAssets,
    playerBaseHealth: synchronizedAssets.find(asset => asset.kind === 'base')!.health,
    enemyBaseHealth: enemyBase.health,
    economy: (input.economy as EconomyState | undefined) ?? createEconomyState(),
    debugScenario,
    setup: setup as CampaignSetupState | undefined,
    lastResult: input.phase === 'execute' ? undefined : input.lastResult as RoundResult | undefined,
  } as MatchState
}
