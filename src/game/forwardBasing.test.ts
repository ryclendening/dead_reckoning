import { describe, expect, it } from 'vitest'
import { createMatch } from './data'
import { MAX_FLIGHT_DISTANCE } from './engine'
import { deriveRecoveryPlanningView, fieldAtRouteEnd, firstRouteFobLatch, formationField, normalizeFormationBasing, validateRecoveryPackage } from './forwardBasing'
import type { Asset, MatchState, Point } from './types'

const withFob = (position: Point = [0, 0], basedFormationIds: string[] = []): MatchState => {
  const state = createMatch()
  const fob: Asset = { id: 'p-fob-1', kind: 'fob', name: 'FOB ALPHA', position, intel: 'confirmed', confidence: 100, health: 100, maxHealth: 100, hidden: false, struck: false, operational: true, capacity: 1, basedFormationIds }
  return { ...state, playerAssets: [...state.playerAssets, fob] }
}

describe('forward basing planning model', () => {
  it('normalizes every live formation to one field and gives explicit FOB assignments precedence', () => {
    const state = withFob([0, 0], ['raven', 'raven', 'missing'])
    const assets = normalizeFormationBasing(state.squadrons, state.playerAssets)
    expect(formationField(assets, 'raven')?.id).toBe('p-fob-1')
    expect(assets.find(asset => asset.kind === 'base')?.basedFormationIds).not.toContain('raven')
    expect(assets.flatMap(asset => asset.basedFormationIds ?? []).filter(id => id === 'raven')).toHaveLength(1)
  })

  it('latches the first crossed FOB and truncates later route points into a landing order', () => {
    const state = withFob([2, 2])
    const base = formationField(state.playerAssets, 'viper')!
    const route: Point[] = [base.position, [2, 2.5], [8, 8]]
    const view = deriveRecoveryPlanningView(state, 'viper', route, MAX_FLIGHT_DISTANCE.fighter)!
    expect(fieldAtRouteEnd(state.playerAssets, route)).toBeUndefined()
    expect(firstRouteFobLatch(state.playerAssets, route)?.field.id).toBe('p-fob-1')
    expect(view.normalizedRoute.at(-1)).toEqual([2, 2])
    expect(view.normalizedRoute).toHaveLength(2)
    expect(view.intendedField.id).toBe('p-fob-1')
    expect(view.summary).toContain('RECOVERY: FOB ALPHA')
  })

  it('does not immediately latch the FOB from which the formation launches', () => {
    const state = withFob([0, 0], ['viper'])
    const route: Point[] = [[0, 0], [3, 3], [5, 5]]
    expect(firstRouteFobLatch(state.playerAssets, route)).toBeUndefined()
    expect(deriveRecoveryPlanningView(state, 'viper', route, MAX_FLIGHT_DISTANCE.fighter)?.intendedField.id).toBe('p-fob-1')
  })

  it('keeps nominal range fixed while calculating recovery against launch or destination fields', () => {
    const state = withFob([0, 0])
    const base = formationField(state.playerAssets, 'viper')!
    const landing = deriveRecoveryPlanningView(state, 'viper', [base.position, [0, 0]], MAX_FLIGHT_DISTANCE.fighter)!
    const patrol = deriveRecoveryPlanningView(state, 'viper', [base.position, [0, 0.8]], MAX_FLIGHT_DISTANCE.fighter)!
    expect(landing.missionDistance).toBeLessThanOrEqual(MAX_FLIGHT_DISTANCE.fighter)
    expect(patrol.missionDistance).toBeGreaterThan(landing.missionDistance)
  })

  it('enforces first-confirmed capacity and rejects unconfirmed recovery packages', () => {
    const initial = withFob([0, 0])
    const base = formationField(initial.playerAssets, 'viper')!
    const state = { ...initial, squadrons: initial.squadrons.map(squadron => squadron.id === 'viper' ? { ...squadron, route: [base.position, [0, 0]] as Point[], plannedRecoveryFieldId: 'p-fob-1' } : squadron.id === 'falcon' ? { ...squadron, route: [base.position, [0, 0]] as Point[] } : { ...squadron, aircraft: 0, strength: 0 }) }
    expect(deriveRecoveryPlanningView(state, 'falcon', state.squadrons.find(item => item.id === 'falcon')!.route, MAX_FLIGHT_DISTANCE.fighter)).toMatchObject({ valid: false, reason: 'FOB ALPHA IS AT CAPACITY' })
    expect(validateRecoveryPackage(state, MAX_FLIGHT_DISTANCE)).toMatchObject({ valid: false })
  })

  it('keeps formations at an unusable FOB trapped and out of valid planning', () => {
    const initial = withFob([0, 0], ['viper'])
    const state = { ...initial, playerAssets: initial.playerAssets.map(asset => asset.id === 'p-fob-1' ? { ...asset, operational: false } : asset), squadrons: initial.squadrons.map(squadron => squadron.id === 'viper' ? { ...squadron, status: 'trapped' as const, route: [[0, 0]] as Point[] } : { ...squadron, aircraft: 0, strength: 0 }) }
    expect(formationField(normalizeFormationBasing(state.squadrons, state.playerAssets), 'viper')?.id).toBe('p-fob-1')
    expect(deriveRecoveryPlanningView(state, 'viper', [[0, 0], [1, 1]], MAX_FLIGHT_DISTANCE.fighter)).toMatchObject({ valid: false, reason: 'FOB ALPHA IS UNUSABLE' })
  })
})
