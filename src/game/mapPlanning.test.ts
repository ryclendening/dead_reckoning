import { describe, expect, it } from 'vitest'
import { createMatch } from './data'
import { approachWaypoints, mapProtectOrder, mapStrikeOrder, resetMapOrder } from './mapPlanning'
import { fighterResponsibilityFor } from './missionResponsibility'
import { normalizeMatch } from './persistence'
import type { Point } from './types'

function setup() {
  const state = createMatch()
  const launch = state.playerAssets.find(asset => asset.id === 'p-base')!.position
  const point = (x: number, z: number): Point => [launch[0] + x, launch[1] + z]
  const approach = [point(1, -1), point(2, -2)]
  state.enemyAssets = state.enemyAssets.map(asset => asset.kind === 'radar'
    ? { ...asset, position: point(7, -3), intel: 'confirmed', hidden: false }
    : asset)
  const fighter = {
    ...resetMapOrder(state.squadrons[0], launch),
    route: [launch, ...approach], routeIngress: [launch, ...approach],
  }
  return { state, fighter, approach, launch, point }
}

describe('map-first fighter orders', () => {
  it('keeps the plotted approach when assigning a confirmed non-base site', () => {
    const { state, fighter, approach, launch } = setup()
    const strike = mapStrikeOrder(state, fighter, 'e-radar')!
    expect(strike.mission).toBe('base-strike')
    expect(strike.strikeTargetId).toBe('e-radar')
    expect(strike.route.slice(0, -1)).toEqual([launch, ...approach])
    expect(mapStrikeOrder(state, fighter, 'e-base')).toBeUndefined()
  })

  it('replaces only the previous mission endpoint and uses the drawn ring as both orbit and coverage', () => {
    const { state, fighter, approach, launch, point } = setup()
    const strike = mapStrikeOrder(state, fighter, 'e-radar')!
    const center = point(2, 2)
    const protect = mapProtectOrder(state, strike, center, 1.8)!
    expect(approachWaypoints(protect, state.playerAssets)).toEqual(approach)
    expect(protect.routeIngress).toEqual([launch, ...approach, center])
    expect(protect.strikeTargetId).toBeUndefined()
    expect(fighterResponsibilityFor(protect)).toEqual({ kind: 'circle', center, radius: 1.8 })
    for (const [x, z] of protect.route.slice(protect.routeIngress.length)) {
      expect(Math.hypot(x - center[0], z - center[1])).toBeCloseTo(1.8)
    }
    const saved = normalizeMatch(JSON.parse(JSON.stringify({
      ...state, squadrons: state.squadrons.map(flight => flight.id === protect.id ? protect : flight),
    })))
    expect(saved.squadrons.find(flight => flight.id === protect.id)?.protectRadius).toBe(1.8)
  })

  it('promotes the last waypoint to the station and keeps recovery while resizing', () => {
    const { state, fighter, approach, launch, point } = setup()
    const center = approach.at(-1)!
    const recoveryWaypoints = [point(1, 1)]
    const protect = mapProtectOrder(state, { ...fighter, plannedRecoveryFieldId: 'p-base', recoveryWaypoints }, center, 1.8)!
    expect(protect.routeIngress).toEqual([launch, ...approach])
    const resized = mapProtectOrder(state, protect, center, 2.5)!
    expect(resized.routeIngress).toEqual(protect.routeIngress)
    expect(resized.protectRadius).toBe(2.5)
    expect(resized.plannedRecoveryFieldId).toBe('p-base')
    expect(resized.recoveryWaypoints).toEqual(recoveryWaypoints)
  })
})
