import { describe, expect, it } from 'vitest'
import { applyRound, MAX_FLIGHT_DISTANCE, resolveRound } from './engine'
import { beginNextRound, executeEconomyCommand, openAdaptPhase } from './economy'
import { confirmCampaignSetup, validateCampaignSetup } from './campaignSetup'
import { createCampaignDraft } from './data'
import { deriveRecoveryPlanningView, validateRecoveryPackage } from './forwardBasing'
import { deriveKnownEnvelope, derivePlanningEnvelope } from './world'
import { buildGroundStrikeRoute, generateRouteTemplate, validateGroundStrikeOrder } from './routeTemplates'
import { campaignOutcome, confirmedStrikeTarget } from './campaign'
import { normalizeMatch } from './persistence'
import type { MatchState, Point, Squadron } from './types'

function openingPackage(seed: number): MatchState {
  // Keep the original resolver fixture deterministic; adaptive campaign coverage lives in cpu/cpu.test.ts.
  const draft = { ...createCampaignDraft(seed), cpu: undefined }
  const selectedFormationIds = ['viper', 'falcon', 'raven']
  const selectedAssetIds = ['p-base', 'p-radar', 'p-sam', 'p-aaa']
  const setup = {
    stage: 'review' as const,
    selectedFormationIds,
    selectedAssetIds,
    placedAssetIds: selectedAssetIds,
  }
  expect(validateCampaignSetup({ ...draft, setup }, setup)).toEqual([])
  return confirmCampaignSetup({ ...draft, setup })
}

function searchFrontier(state: MatchState): Point {
  const bounds = derivePlanningEnvelope(deriveKnownEnvelope(state.world, state.mappedAreas, state.discoveredBoundaries, state.world.friendlyTerritory))
  const [homeX, homeZ] = state.world.friendlyTerritory.center
  const oppositeX = homeX >= 0 ? -1 : 1
  const oppositeZ = homeZ >= 0 ? -1 : 1
  return [oppositeX < 0 ? bounds.minX + .25 : bounds.maxX - .25, oppositeZ < 0 ? bounds.minZ + .25 : bounds.maxZ - .25]
}

function planRound(input: MatchState): MatchState {
  const state = { ...input, squadrons: input.squadrons.map(squadron => ({ ...squadron })) }
  const bounds = derivePlanningEnvelope(deriveKnownEnvelope(state.world, state.mappedAreas, state.discoveredBoundaries, state.world.friendlyTerritory))
  const target = confirmedStrikeTarget(state)
  const frontier = searchFrontier(state)
  state.squadrons = state.squadrons.map(squadron => {
    if (squadron.aircraft <= 0 || squadron.status === 'trapped') return squadron
    // Once coordinates are recovered, keep recon grounded instead of repeatedly crossing a live SAM.
    if (target && squadron.role === 'recon') return { ...squadron, sortieOrdered: false, plannedRecoveryFieldId: undefined }
    squadron.sortieOrdered = true
    if (target && squadron.role === 'fighter') {
      const anchors = buildGroundStrikeRoute(state, squadron.id, target.id)
      // Use an optional flank waypoint to keep the strike ingress out of the central fighter lane.
      const route = anchors && (()=>{const [launch,release]=anchors,dx=release[0]-launch[0],dz=release[1]-launch[1],length=Math.hypot(dx,dz);return [launch,[(launch[0]+release[0])/2-dz/length*6,(launch[1]+release[1])/2+dx/length*6] as Point,release]})()
      if (route) return { ...squadron, mission: 'base-strike', strikeTargetId: target.id, route, routeIngress: route, plannedRecoveryFieldId: undefined }
    }

    const origin = state.playerAssets.find(asset => asset.kind === 'base')!.position
    const ingress = squadron.role === 'recon'
      ? [[...origin] as Point, frontier]
      : [[...origin] as Point, [origin[0] + (state.world.friendlyTerritory.center[0] >= 0 ? -1 : 1) * 1.5, origin[1]] as Point]
    const generated = generateRouteTemplate({
      template: squadron.role === 'recon' ? 'search-area' : 'defensive-cap',
      ingress,
      maxDistance: MAX_FLIGHT_DISTANCE[squadron.role],
      bounds,
    })
    return {
      ...squadron,
      mission: squadron.role === 'recon' ? 'search-area' : 'defensive-cap',
      route: generated.route,
      routeIngress: generated.ingress,
      plannedRecoveryFieldId: undefined,
    }
  })

  for (const squadron of state.squadrons.filter(item => item.aircraft > 0 && item.status !== 'trapped' && item.sortieOrdered !== false)) {
    const view = deriveRecoveryPlanningView(state, squadron.id, squadron.route, MAX_FLIGHT_DISTANCE[squadron.role])
    expect(view?.valid, `${squadron.callsign} route should preserve legal recovery`).toBe(true)
    if (view) {
      squadron.route = view.normalizedRoute
      squadron.plannedRecoveryFieldId = view.intendedField.id
      if (squadron.mission === 'base-strike') expect(validateGroundStrikeOrder(state, squadron)).toBeUndefined()
    }
  }
  expect(validateRecoveryPackage(state, MAX_FLIGHT_DISTANCE, new Set(state.squadrons.filter(item => item.sortieOrdered !== false).map(item => item.id)))).toEqual({ valid: true })
  return state
}

function recoverAtAdapt(state: MatchState): MatchState {
  const settled = openAdaptPhase(state)
  if (settled.phase !== 'adapt') return settled
  return beginNextRound(service(settled))
}

function service(state: MatchState): MatchState {
  let next = state
  const serviceOrder = [...next.squadrons].sort((a, b) => Number(b.role === 'fighter') - Number(a.role === 'fighter') || a.id.localeCompare(b.id))
  for (const squadron of serviceOrder) {
    while ((next.squadrons.find(item => item.id === squadron.id)?.aircraft ?? 0) < squadron.maxAircraft && next.replacements > 0 && next.logistics >= 4) {
      const before = next
      next = executeEconomyCommand(next, { actionId: 'replace-aircraft', target: { kind: 'squadron', id: squadron.id } })
      if (next === before) break
    }
    while ((next.squadrons.find(item => item.id === squadron.id)?.strength ?? 100) < 100 && next.logistics >= 2) {
      const before = next
      next = executeEconomyCommand(next, { actionId: 'repair-formation', target: { kind: 'squadron', id: squadron.id } })
      if (next === before) break
    }
  }
  return next
}

describe('scripted legal campaign integration', () => {
  it('discovers the base through recovered recon and wins with legal fighter strikes', () => {
    let state = openingPackage(7301)
    expect(state.setup).toBeUndefined()
    expect(state.squadrons.map(item => item.id)).toEqual(['viper', 'falcon', 'raven'])
    expect(confirmedStrikeTarget(state)).toBeUndefined()

    let victoryRound: number | undefined
    for (let round = 1; round <= 6; round++) {
      state = planRound(state)
      const result = resolveRound(state)
      state = applyRound(state, result)
      expect(state.phase).toBe('debrief')

      const reconOrdered=state.squadrons.find(squadron=>squadron.id==='raven')?.sortieOrdered!==false
      expect(result.recoveryOutcomes.find(outcome => outcome.formationId === 'raven')?.outcome).toBe('recovered')
      if(!reconOrdered)expect(result.unitTracks.find(track=>track.unitId==='raven')?.frames.every(frame=>frame.mode==='grounded')).toBe(true)

      const afterDebrief = recoverAtAdapt(state)
      if (afterDebrief.phase === 'victory') {
        victoryRound = round
        state = afterDebrief
        break
      }
      expect(afterDebrief.phase, JSON.stringify({ round, outcome: campaignOutcome(afterDebrief), home: afterDebrief.playerBaseHealth, enemy: afterDebrief.enemyBaseHealth, exposure: afterDebrief.baseExposure, losses: state.lastResult?.friendlyAttrition, enemyEvents: state.lastResult?.events.filter(event => event.title.includes('BASE')) })).toBe('plan')
      state = { ...normalizeMatch(JSON.parse(JSON.stringify(afterDebrief))), cpu: undefined }
      expect(state.round).toBe(round + 1)
      expect(state.phase).toBe('plan')
    }

    expect(victoryRound).toBeDefined()
    expect(victoryRound).toBe(3)
    expect(victoryRound).toBeLessThanOrEqual(6)
    expect(campaignOutcome(state)).toBe('enemy-base-destroyed')
    expect(state.enemyBaseHealth).toBe(0)
    expect(state.squadrons.every((squadron: Squadron) => squadron.aircraft > 0)).toBe(true)
  })
})
