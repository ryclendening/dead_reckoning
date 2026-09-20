import { describe, expect, it } from 'vitest'
import { createMatch } from './data'
import { formationBaseGroups } from './formationBasing'
import { airfieldFirstPlanningIds, nextUnplannedFormationId, planningPackageReady, viablePlanningFormationIds } from './planningQueue'
import type { Asset } from './types'

describe('sequential planning queue', () => {
  it('requires every surviving formation to be explicitly reviewed with a valid route', () => {
    const match = createMatch()
    const ids = viablePlanningFormationIds(match.squadrons)
    expect(planningPackageReady(match.squadrons, new Set(ids.slice(0, -1)))).toBe(false)
    expect(planningPackageReady(match.squadrons, new Set(ids))).toBe(true)

    const withoutRoute = match.squadrons.map((squadron, index) => index === 0 ? { ...squadron, route: [squadron.route[0]] } : squadron)
    expect(planningPackageReady(withoutRoute, new Set(ids))).toBe(false)
  })

  it('cycles to the first unplanned formation and excludes destroyed formations', () => {
    const match = createMatch()
    const squadrons = match.squadrons.map((squadron, index) => index === 1 ? { ...squadron, aircraft: 0 } : squadron)
    const ids = viablePlanningFormationIds(squadrons)
    expect(ids).not.toContain(match.squadrons[1].id)
    expect(nextUnplannedFormationId(ids, new Set([ids[0]]))).toBe(ids[1])
    expect(nextUnplannedFormationId(ids, new Set(ids))).toBeUndefined()
  })

  it('finishes the selected airfield before moving to another airfield', () => {
    const match = createMatch()
    const fob: Asset = { id: 'fob-1', kind: 'fob', name: 'FOB ALPHA', position: [0, 0], intel: 'confirmed', confidence: 100, health: 100, maxHealth: 100, hidden: false, struck: false, operational: true, capacity: 1, basedFormationIds: [match.squadrons[0].id] }
    const groups = formationBaseGroups(match.squadrons, [...match.playerAssets, fob])
    const ids = airfieldFirstPlanningIds(match.squadrons, groups, 'fob-1')
    expect(ids[0]).toBe(match.squadrons[0].id)
    expect(ids.slice(1)).toEqual(groups.find(group => group.base.kind === 'base')?.formationIds)
  })
})
