import { describe, expect, it } from 'vitest'
import { createMatch } from './data'
import { MAX_FLIGHT_DISTANCE } from './engine'
import { deriveRecoveryPlanningView, deriveRouteBudget, formationField, normalizeFormationBasing, routeDistanceForBasing, routeToRecoveryField, validateRecoveryPackage } from './forwardBasing'
import type { Asset, MatchState, Point } from './types'

const withFob = (position: Point = [0, 0], basedFormationIds: string[] = []): MatchState => {
  const state = createMatch()
  const fob: Asset = { id: 'p-fob-1', kind: 'fob', name: 'FOB ALPHA', position, intel: 'confirmed', confidence: 100, health: 100, maxHealth: 100, hidden: false, struck: false, operational: true, capacity: 1, basedFormationIds }
  return { ...state, playerAssets: [...state.playerAssets, fob] }
}

describe('forward basing planning model', () => {
  it('breaks the committed route into ingress, pattern, recovery, and remaining range', () => {
    const state = withFob([2, 2])
    const squadron = state.squadrons.find(item => item.id === 'viper')!
    const route: Point[] = [squadron.routeIngress[0], squadron.routeIngress[1], [2, 2]]
    const budget = deriveRouteBudget(state, squadron.id, route, squadron.routeIngress, MAX_FLIGHT_DISTANCE.fighter)!
    expect(budget.ingressDistance).toBeLessThanOrEqual(routeDistanceForBasing(squadron.routeIngress))
    expect(budget.missionDistance).toBeCloseTo(budget.ingressDistance + budget.patternDistance + budget.recoveryReserve, 6)
    expect(budget.remainingRange).toBeCloseTo(MAX_FLIGHT_DISTANCE.fighter - budget.missionDistance, 6)
  })

  it('normalizes every live formation to one field and gives explicit FOB assignments precedence', () => {
    const state = withFob([0, 0], ['raven', 'raven', 'missing'])
    const assets = normalizeFormationBasing(state.squadrons, state.playerAssets)
    expect(formationField(assets, 'raven')?.id).toBe('p-fob-1')
    expect(assets.find(asset => asset.kind === 'base')?.basedFormationIds).not.toContain('raven')
    expect(assets.flatMap(asset => asset.basedFormationIds ?? []).filter(id => id === 'raven')).toHaveLength(1)
  })

  it('keeps a Protect route and its return intact when it passes directly through a FOB', () => {
    const state = withFob([2, 2])
    const base = formationField(state.playerAssets, 'viper')!
    const route: Point[] = [base.position, [2, 2], [4, 4]]
    const view = deriveRecoveryPlanningView(state, 'viper', route, MAX_FLIGHT_DISTANCE.fighter)!
    expect(view.normalizedRoute).toEqual(route)
    expect(view.intendedField.id).toBe(base.id)
    expect(view.recoveryRoute).toEqual([[4, 4], base.position])
  })

  it('keeps the mission route when a FOB is explicitly selected on the return leg', () => {
    const state = withFob([2, 2])
    const base = formationField(state.playerAssets, 'viper')!
    const squadron=state.squadrons.find(item=>item.id==='viper')!
    squadron.plannedRecoveryFieldId='p-fob-1'
    squadron.recoveryWaypoints=[[5, 4]]
    const route:Point[]=[base.position,[2,2],[4,4]]
    const view=deriveRecoveryPlanningView(state,squadron.id,route,MAX_FLIGHT_DISTANCE.fighter)!
    expect(view.normalizedRoute).toEqual(route)
    expect(view.recoveryRoute).toEqual([[4, 4],[5, 4],[2, 2]])
    expect(view.intendedField.id).toBe('p-fob-1')
  })

  it('requires a selected landing field on outbound Transit and preserves points on the way there', () => {
    const state=withFob([0,0])
    const squadron=state.squadrons.find(item=>item.id==='viper')!
    squadron.mission='transit'
    const base=formationField(state.playerAssets,squadron.id)!
    const enRoute:Point=[2,2]
    squadron.routeIngress=[base.position,enRoute]
    const route=routeToRecoveryField(state,squadron.id,'p-fob-1')!
    expect(route).toEqual([base.position,enRoute,[0,0]])
    expect(deriveRecoveryPlanningView(state,squadron.id,route,40)?.intendedField.id).toBe(base.id)
    squadron.plannedRecoveryFieldId='p-fob-1'
    expect(deriveRecoveryPlanningView(state,squadron.id,route,40)).toMatchObject({valid:true,recoveryRoute:[],intendedField:{id:'p-fob-1'}})
  })

  it('lets recon and a fighter share a FOB, then rejects a third confirmed recovery', () => {
    const initial = withFob([0, 0], ['raven'])
    const base = formationField(initial.playerAssets, 'viper')!
    const state = { ...initial, squadrons: initial.squadrons.map(squadron => squadron.id === 'viper' ? { ...squadron, route: [base.position, [0, 0]] as Point[], plannedRecoveryFieldId: 'p-fob-1' } : squadron.id === 'falcon' ? { ...squadron, route: [base.position, [0, 0]] as Point[] } : squadron.id === 'raven' ? squadron : { ...squadron, aircraft: 0, strength: 0 }) }
    expect(normalizeFormationBasing(state.squadrons, state.playerAssets).find(asset => asset.id === 'p-fob-1')?.capacity).toBe(2)
    expect(deriveRecoveryPlanningView(state, 'viper', state.squadrons.find(item => item.id === 'viper')!.route, MAX_FLIGHT_DISTANCE.fighter)?.valid).toBe(true)
    const full={...state,squadrons:state.squadrons.map(squadron=>squadron.id==='falcon'
      ? {...squadron,plannedRecoveryFieldId:'p-fob-1'}
      : squadron)}
    expect(deriveRecoveryPlanningView(full, 'falcon', full.squadrons.find(item => item.id === 'falcon')!.route, MAX_FLIGHT_DISTANCE.fighter)).toMatchObject({ valid: false, reason: 'FOB ALPHA IS AT CAPACITY' })
    expect(validateRecoveryPackage(full, MAX_FLIGHT_DISTANCE)).toMatchObject({ valid: false })
  })

  it('keeps formations at an unusable FOB trapped and out of valid planning', () => {
    const initial = withFob([0, 0], ['viper'])
    const state = { ...initial, playerAssets: initial.playerAssets.map(asset => asset.id === 'p-fob-1' ? { ...asset, operational: false } : asset), squadrons: initial.squadrons.map(squadron => squadron.id === 'viper' ? { ...squadron, status: 'trapped' as const, route: [[0, 0]] as Point[] } : { ...squadron, aircraft: 0, strength: 0 }) }
    expect(formationField(normalizeFormationBasing(state.squadrons, state.playerAssets), 'viper')?.id).toBe('p-fob-1')
    expect(deriveRecoveryPlanningView(state, 'viper', [[0, 0], [1, 1]], MAX_FLIGHT_DISTANCE.fighter)).toMatchObject({ valid: false, reason: 'FOB ALPHA IS UNUSABLE' })
  })
})
