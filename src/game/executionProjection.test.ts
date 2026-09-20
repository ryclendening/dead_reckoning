import { describe, expect, it } from 'vitest'
import { contactProjectionAt, projectFriendlyUnitAt, projectHostileUnitAt, sampleUnitTrack, unitTrackFor, visibleTrackSegments } from './executionProjection'
import { resolveRound } from './engine'
import { createScenario } from './scenarios'
import type { RoundResult, UnitTrack } from './types'

const track: UnitTrack = {
  unitId: 'red-fighter',
  frames: [
    { time: 0, position: [0, 0], facing: [1, 0], mode: 'following-route', strength: 100, morale: 80, aircraft: 4, traveledDistance: 0 },
    { time: 1, position: [2, 4], facing: [3, 4], mode: 'intercepting', strength: 60, morale: 40, aircraft: 2, traveledDistance: 6 },
    { time: 2, position: [3, 6], facing: [4, 6], mode: 'dogfighting', strength: 40, morale: 30, aircraft: 2, traveledDistance: 8 },
  ],
}

function resultWithContacts(): RoundResult {
  return {
    round: 1,
    duration: 2,
    tickSeconds: .05,
    unitTracks: [track],
    contactIntervals: [
      { id: 'radar-1', observerId: 'viper', targetId: 'red-fighter', source: 'radar', start: .25, end: .75, position: [0, 0] },
      { id: 'visual-1', observerId: 'viper', targetId: 'red-fighter', source: 'visual', start: .5, end: 1, position: [0, 0] },
      { id: 'radar-2', observerId: 'falcon', targetId: 'red-fighter', source: 'radar', start: 1.25, end: 1.75, position: [0, 0] },
    ],
    behaviorIntervals: [], events: [], squadrons: [], assets: [], enemyLosses: 0, friendlyLosses: 0,
    friendlyAttrition: [], enemyAttrition: [], friendlyFormationsDestroyed: 0, enemyFormationsDestroyed: 0,
    intelGained: [], baseDamage: 0, enemyBaseDamage: 0, logisticsIncome: { base: 0, intel: 0, enemyAircraft: 0, total: 0 }, command: 0,
    executionRoutes: {}, enemyFlights: [], defenseCues: [], defensiveAwareness: 0, lessons: [], playerAssets: [], reinforcementCalls: [],
    roundScore: 0, baseExposure: 0, baseExposureDelta: 0, combatSequences: [], weaponEffects: [], contactObservations: [], radarTrackReceipts: [], interceptPlans: [], intelReports: [], mappedAreas: [], discoveredBoundaries: [], recoveryOutcomes: [],
  }
}

describe('execution projection', () => {
  it('interpolates continuous track fields and keeps discrete state authoritative', () => {
    expect(sampleUnitTrack(track, -.2)).toEqual(track.frames[0])
    expect(sampleUnitTrack(track, 3)).toEqual(track.frames[2])
    expect(sampleUnitTrack(track, .5)).toMatchObject({
      time: .5,
      position: [1, 2],
      facing: [2, 2],
      mode: 'following-route',
      strength: 80,
      morale: 60,
      aircraft: 4,
      traveledDistance: 3,
    })
    expect(sampleUnitTrack(track, 1)?.mode).toBe('intercepting')
    expect(sampleUnitTrack(track, 1)?.aircraft).toBe(2)
  })

  it('uses visual contact over radar and remembers learned identity in simulated seconds', () => {
    const result = resultWithContacts()
    expect(contactProjectionAt(result, 'red-fighter', .3)).toMatchObject({ level: 'radar', identityKnown: false })
    expect(contactProjectionAt(result, 'red-fighter', .6)).toMatchObject({ level: 'visual', identityKnown: true })
    expect(contactProjectionAt(result, 'red-fighter', 1.1)).toBeUndefined()
    expect(contactProjectionAt(result, 'red-fighter', 1.5)).toMatchObject({ level: 'radar', identityKnown: true })
  })

  it('fails closed for hostile truth when no current contact exists', () => {
    const result = resultWithContacts()
    expect(projectHostileUnitAt(result, 'red-fighter', .1)).toBeUndefined()
    expect(projectHostileUnitAt(result, 'red-fighter', 1.1)).toBeUndefined()
    expect(projectHostileUnitAt(result, 'red-fighter', 1.5)).toMatchObject({
      visibility: 'radar',
      identityKnown: true,
      frame: { position: [2.5, 5], aircraft: 2 },
    })
    expect(projectFriendlyUnitAt(result, 'red-fighter', 1.1)?.frame.position).toEqual([2.1, 4.2])
    expect(projectHostileUnitAt({ ...result, unitTracks: [] }, 'red-fighter', .5)).toBeUndefined()
  })

  it('splits visible history at hidden gaps and contact-source transitions', () => {
    const segments = visibleTrackSegments(resultWithContacts(), 'red-fighter')
    expect(segments.map(segment => [segment.visibility, segment.identityKnown, segment.frames[0].time, segment.frames.at(-1)?.time])).toEqual([
      ['radar', false, .25, .5],
      ['visual', true, .5, 1],
      ['radar', true, 1.25, 1.75],
    ])
    expect(segments.some((segment, index) => index > 0 && segments[index - 1].frames.at(-1)!.time < segment.frames[0].time)).toBe(true)
  })

  it('projects reaction-interruption positions directly from recorded tracks', () => {
    const result = resolveRound(createScenario('reaction-interrupt'))
    const dogfight = result.combatSequences.find(sequence => sequence.kind === 'dogfight')
    expect(dogfight).toBeDefined()
    const seconds = dogfight!.start
    const friendly = projectFriendlyUnitAt(result, 'viper', seconds)
    const hostile = projectHostileUnitAt(result, 'red-fighter', seconds)
    expect(friendly?.frame).toEqual(sampleUnitTrack(unitTrackFor(result, 'viper'), seconds))
    expect(hostile?.frame).toEqual(sampleUnitTrack(unitTrackFor(result, 'red-fighter'), seconds))
    expect(friendly?.frame.mode).toBe('dogfighting')
    expect(hostile?.frame.mode).toBe('dogfighting')
  })
})
