import { describe, expect, it } from 'vitest'
import { createMatch } from './data'
import { airfieldLabel, formationBaseGroups, formationBaseId } from './formationBasing'
import type { Asset } from './types'

describe('formation basing projection', () => {
  it('keeps unassigned formations at the main airfield', () => {
    const match = createMatch()
    const groups = formationBaseGroups(match.squadrons, match.playerAssets)
    expect(groups).toHaveLength(1)
    expect(groups[0].formationIds).toEqual(match.squadrons.map(squadron => squadron.id))
    expect(airfieldLabel(groups[0].base)).toBe('HOME BASE')
  })

  it('groups explicit FOB assignments without duplicating formations', () => {
    const match = createMatch()
    const fob: Asset = {
      id: 'fob-1', kind: 'fob', name: 'FOB ALPHA', position: [0, 0], intel: 'confirmed',
      confidence: 100, health: 100, maxHealth: 100, hidden: false, struck: false,
      operational: true, capacity: 1, basedFormationIds: ['raven'],
    }
    const groups = formationBaseGroups(match.squadrons, [...match.playerAssets, fob])
    expect(groups[0].formationIds).not.toContain('raven')
    expect(groups[1].formationIds).toEqual(['raven'])
    expect(formationBaseId(groups, 'raven')).toBe('fob-1')
  })
})
