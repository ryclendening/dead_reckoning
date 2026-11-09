import { describe, expect, it } from 'vitest'
import { createMatch } from './data'
import { executeEconomyCommand, validateAssetPlacement } from './economy'
import { executeCpuEconomyCommand } from './cpu/economy'
import { legalPlacements } from './cpu/placement'
import { cpuPlanningView } from './cpu/planningView'
import { sidePlanningContext } from './sideContext'
import { validateAssetPlacement as validateSidePlacement } from './sideEconomy'
import { friendlyTerritoryForAssets, territoryContains } from './territory'
import type { Asset, ConstructibleAssetKind, EconomyCommand, MatchState, Point } from './types'

const target = { kind: 'campaign', id: 'campaign' } as const
const forward: Point = [10.5, 0]
const gap: Point = [6, 4]

describe.each(['player', 'cpu'] as const)('%s territory construction', side => {
  function fixture(): MatchState {
    const initial = createMatch(7301)
    const base = { ...initial.playerAssets.find(a => a.kind === 'base')!, position: [0, 0] as Point }
    const fob: Asset = { ...base, id: 'test-fob', kind: 'fob', position: [8, 0], operational: true, basedFormationIds: [], capacity: 2 }
    const assets = [base, fob]
    // Mapping includes both the forward site and a gap outside either territory circle.
    const mappedAreas: Point[] = [forward, gap, [8, 0], [12, 0]]
    return { ...initial, phase: 'adapt', logistics: 100, playerAssets: assets, mappedAreas,
      world: { ...initial.world, friendlyTerritory: { center: [0, 0], radius: 4.5 } },
      enemyAssets: assets.map(a => ({ ...a, id: a.kind === 'base' ? 'e-base' : a.id })),
      cpu: { ...initial.cpu!, logistics: 100, mappedAreas } }
  }
  const validate = (state: MatchState, kind: ConstructibleAssetKind, point: Point) => side === 'player'
    ? validateAssetPlacement(state, kind, point) : validateSidePlacement(sidePlanningContext(state, side), kind, point)
  const execute = (state: MatchState, command: EconomyCommand) => side === 'player'
    ? executeEconomyCommand(state, command) : executeCpuEconomyCommand(state, command)
  const damageFob = (state: MatchState, damage: Partial<Asset>) => ({ ...state,
    [side === 'player' ? 'playerAssets' : 'enemyAssets']: sidePlanningContext(state, side).assets.map(a => a.kind === 'fob' ? { ...a, ...damage } : a) })

  it.each(['sam', 'aaa', 'decoy'] as const)('limits %s to the actual territory union even on recovered terrain', kind => {
    const state = fixture()
    expect(validate(state, kind, [0, 3]).valid).toBe(true)
    expect(validate(state, kind, forward).valid).toBe(true)
    for (const point of [gap, [12, 0], [900, 900]] as Point[]) {
      expect(validate(state, kind, point)).toEqual({ valid: false, reason: 'SITE MUST BE INSIDE FRIENDLY TERRITORY' })
      expect(execute(state, { actionId: `build-${kind}`, target, placement: point })).toBe(state)
    }
    const built = execute(state, { actionId: `build-${kind}`, target, placement: forward })
    expect(sidePlanningContext(built, side).assets.at(-1)).toMatchObject({ kind, position: forward })
    expect(sidePlanningContext(built, side).logistics).toBeLessThan(100)
  })

  it.each([{ operational: false }, { health: 0 }])('rechecks FOB influence at purchase after damage %j', damage => {
    const state = fixture()
    const command: EconomyCommand = { actionId: 'build-sam', target, placement: forward }
    expect(validate(state, 'sam', forward).valid).toBe(true)
    const disabled = damageFob(state, damage)
    expect(validate(disabled, 'sam', forward).valid).toBe(false)
    expect(execute(disabled, command)).toBe(disabled)
    expect(validate(damageFob(disabled, { operational: true, health: 100 }), 'sam', forward).valid).toBe(true)
  })

  it('retains recovered-terrain and seven-unit reach requirements for FOB expansion', () => {
    const state = damageFob(fixture(), { operational: false })
    expect(validate(state, 'fob', gap).valid).toBe(true)
    const built = execute(state, { actionId: 'build-fob', target, placement: gap })
    expect(sidePlanningContext(built, side).assets.at(-1)).toMatchObject({ kind: 'fob', position: gap })
    expect(validate(state, 'fob', [-8, 0]).valid).toBe(false)
    expect(validate(state, 'fob', [12, 0])).toMatchObject({ valid: false, reason: 'FOB MUST BE WITHIN 7 UNITS OF FRIENDLY TERRITORY EDGE' })
  })

  if (side === 'cpu') it('restricts planner SAM candidates to owned circles and removes disabled FOB coverage', () => {
    for (const state of [fixture(), damageFob(fixture(), { operational: false })]) {
      const view = cpuPlanningView(state)!
      const candidates = legalPlacements(view, 'sam')
      const territory = friendlyTerritoryForAssets(view.context.territory, view.assets)
      expect(candidates.length).toBeGreaterThan(0)
      expect(candidates.every(point => territoryContains(point, territory))).toBe(true)
      expect(candidates.some(point => point[0] > 5)).toBe(view.assets.find(a => a.kind === 'fob')!.operational)
    }
  })
})
