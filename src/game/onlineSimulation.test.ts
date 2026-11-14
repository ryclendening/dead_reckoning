import { describe, expect, it } from 'vitest'
import { createMatch } from './data'
import { resolveOnlineRound } from './onlineSimulation'
import type { MatchState } from './types'

function seat(seed: number, offset = 0): MatchState {
  const match = createMatch(seed, 'easy', false)
  const base = match.playerAssets.find(asset => asset.kind === 'base')!
  const dx = offset
  const playerAssets = match.playerAssets.map(asset => ({ ...asset, position: [asset.position[0] + dx, asset.position[1]] as [number, number] }))
  const home = playerAssets.find(asset => asset.kind === 'base')!
  const enemyAssets = match.enemyAssets.map(asset => ({ ...asset, id: `opponent:${asset.id.replace(/^e-/, 'p-')}` }))
  return {
    ...match, cpu: undefined, phase: 'plan', world: { ...match.world, friendlyTerritory: { ...match.world.friendlyTerritory, center: [...home.position] } },
    playerAssets, playerBaseHealth: base.health, enemyAssets, enemyBaseHealth: 100,
    squadrons: match.squadrons.map(squadron => ({ ...squadron, sortieOrdered: false, plannedRecoveryFieldId: undefined })),
  }
}

describe('authoritative online round adapter', () => {
  it('resolves once into self-oriented settled replays without exposing hidden opponent deployment', () => {
    const a = seat(137, 0), b = seat(841, 8)
    const [resolvedA, resolvedB] = resolveOnlineRound([a, b], 991)

    expect(resolvedA.phase).toBe('debrief')
    expect(resolvedB.phase).toBe('debrief')
    expect(resolvedA.lastResult?.round).toBe(a.round)
    expect(resolvedB.lastResult?.round).toBe(b.round)
    expect(resolvedA.squadrons.map(item => item.id)).toEqual(a.squadrons.map(item => item.id))
    expect(resolvedB.squadrons.map(item => item.id)).toEqual(b.squadrons.map(item => item.id))
    expect(resolvedA.lastResult?.cpuReport).toBeUndefined()
    expect(resolvedB.lastResult?.cpuReport).toBeUndefined()
    expect(resolvedA.lastResult?.assets).toEqual([])
    expect(resolvedB.lastResult?.assets).toEqual([])
    expect(resolvedA.lastResult?.enemyFlights).toEqual([])
    expect(resolvedB.lastResult?.enemyFlights).toEqual([])
    expect(resolvedA.lastResult?.unitTracks.every(track => a.squadrons.some(item => item.id === track.unitId))).toBe(true)
    expect(resolvedB.lastResult?.unitTracks.every(track => b.squadrons.some(item => item.id === track.unitId))).toBe(true)
    expect(resolvedA.playerAssets.map(asset => asset.position)).toEqual(a.playerAssets.map(asset => asset.position))
    expect(resolvedB.playerAssets.map(asset => asset.position)).toEqual(b.playerAssets.map(asset => asset.position))
    expect(resolvedA.logistics).toBeGreaterThan(a.logistics)
    expect(resolvedB.logistics).toBeGreaterThan(b.logistics)
  })

  it('is deterministic and keeps opponent identifiers namespaced in authorized contacts', () => {
    const a = seat(201), b = seat(802, 8)
    const first = resolveOnlineRound([a, b], 42)
    const second = resolveOnlineRound([a, b], 42)
    expect(first).toEqual(second)
    for (const state of first) {
      expect(state.lastResult?.contactIntervals.every(interval => interval.targetId.startsWith('opponent:'))).toBe(true)
      expect(state.lastResult?.unitTracks.filter(track => track.unitId.startsWith('opponent:')).every(track =>
        state.lastResult?.contactIntervals.some(interval => interval.targetId === track.unitId))).toBe(true)
    }
  })

  it('applies both base strikes once and reports a simultaneous-destruction draw from both seats', () => {
    const first = seat(333), second = seat(444, 8)
    const aBase = first.playerAssets.find(asset => asset.kind === 'base')!
    const bBase = second.playerAssets.find(asset => asset.kind === 'base')!
    aBase.health = 40
    bBase.health = 40
    aBase.position = [-4, 0]
    bBase.position = [4, 0]
    const prepare = (state: MatchState, launch: typeof aBase, target: typeof bBase): MatchState => ({
      ...state,
      playerAssets: [launch],
      enemyAssets: [{ ...target, id: 'opponent:p-base' }],
      squadrons: state.squadrons.map((squadron, index) => index === 0 ? {
        ...squadron, mission: 'base-strike', sortieOrdered: true,
        strikeTargetId: 'opponent:p-base', plannedRecoveryFieldId: 'p-base',
        route: [launch.position, [launch.position[0] * .5, 0]], routeIngress: [launch.position, [launch.position[0] * .5, 0]],
      } : squadron),
    })
    const pair = resolveOnlineRound([prepare(first, aBase, bBase), prepare(second, bBase, aBase)], 71)
    for (const state of pair) {
      expect(state.onlineOutcome).toBe('mutual-destruction')
      expect(state.playerBaseHealth).toBe(0)
      expect(state.lastResult?.baseDamage).toBe(40)
      expect(state.lastResult?.enemyBaseDamage).toBe(40)
      expect(state.lastResult?.combatSequences.filter(sequence => sequence.kind === 'strike')).toHaveLength(2)
    }
  })

  it('publishes only contact-window slices of an opponent route', () => {
    const a = seat(333), b = seat(444, 8)
    const aBase = a.playerAssets.find(asset => asset.kind === 'base')!.position
    const bBase = b.playerAssets.find(asset => asset.kind === 'base')!.position
    const sendThroughCenter = (state: MatchState, destination: [number, number]) => ({
      ...state, squadrons: state.squadrons.map((squadron, index) => index !== 0 ? squadron : {
        ...squadron, mission: 'transit' as const, sortieOrdered: true, plannedRecoveryFieldId: 'p-base',
        route: [state.playerAssets.find(asset => asset.kind === 'base')!.position, destination],
        routeIngress: [state.playerAssets.find(asset => asset.kind === 'base')!.position, destination],
      }),
    })
    const aOrders = sendThroughCenter(a, bBase)
    const bOrders = sendThroughCenter(b, aBase)
    const [resolvedA, resolvedB] = resolveOnlineRound([aOrders, bOrders], 71)

    const seenByA = resolvedA.lastResult!.contactIntervals.filter(interval => interval.targetId.startsWith('opponent:track-'))
    const seenByB = resolvedB.lastResult!.contactIntervals.filter(interval => interval.targetId.startsWith('opponent:track-'))
    expect(seenByA.length).toBeGreaterThan(0)
    expect(seenByB.length).toBeGreaterThan(0)
    for (const [state, windows] of [[resolvedA, seenByA], [resolvedB, seenByB]] as const) {
      const hostile = state.lastResult!.unitTracks.find(track => track.unitId === windows[0].targetId)
      expect(hostile).toBeDefined()
      expect(hostile!.frames.length).toBeLessThan(state.lastResult!.duration / state.lastResult!.tickSeconds)
      expect(hostile!.frames.every(frame => windows.some(window => frame.time >= window.start - .001 && frame.time <= window.end + .001))).toBe(true)
      const flight = state.lastResult!.enemyFlights.find(item => item.id === hostile!.unitId)
      expect(flight?.route).toEqual(hostile!.frames.map(frame => frame.position))
      expect(flight).not.toHaveProperty('reconPosture')
      expect(flight).not.toHaveProperty('routeIngress')
    }

    const groundedB = { ...b, squadrons: b.squadrons.map(squadron => ({ ...squadron, sortieOrdered: false })) }
    const [, radarReplay] = resolveOnlineRound([aOrders, groundedB], 72)
    expect(radarReplay.lastResult!.contactIntervals.some(interval => interval.observerId === 'p-radar' &&
      interval.targetId.startsWith('opponent:track-') && interval.source === 'radar')).toBe(true)
    expect(radarReplay.lastResult?.events.find(event => event.title === 'SORTIES AIRBORNE')?.detail).toBe('0 aircraft committed.')
    expect(radarReplay.lastResult?.enemyFlights.every(flight => flight.callsign === 'UNKNOWN AIRCRAFT')).toBe(true)
  })
})
