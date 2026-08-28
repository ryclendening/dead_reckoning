import { describe, expect, it } from 'vitest'
import { createMatch } from './data'
import { callReinforcement, repairSquadron } from './engine'
import { formationStatus } from './formationStatus'
import type { Squadron } from './types'

const squadron = (overrides: Partial<Squadron> = {}): Squadron => ({
  id: 'test', callsign: 'TEST 1', role: 'fighter', mission: 'CAP', aggression: 'neutral',
  targetPriority: 'opportunity', aircraft: 4, maxAircraft: 4, damaged: 0, readiness: 88, ammo: 76,
  route: [[0, 0], [1, 1]], routeIngress: [[0, 0], [1, 1]], routeTemplate: 'custom',
  ...overrides,
})

describe('formationStatus', () => {
  it('uses the full authoritative aircraft count as the primary state', () => {
    expect(formationStatus(squadron())).toMatchObject({
      aircraft: 4, maxAircraft: 4, aircraftFraction: 1, destroyed: false,
      readiness: 88, ammo: 76,
    })
  })

  it('represents partial losses independently from readiness and ammunition', () => {
    const status = formationStatus(squadron({ aircraft: 2, readiness: 100, ammo: 0, damaged: 1 }))
    expect(status).toMatchObject({ aircraft: 2, maxAircraft: 4, aircraftFraction: .5, destroyed: false, damaged: 1 })
    expect(status.readiness).toBe(100)
    expect(status.ammo).toBe(0)
  })

  it('marks an empty formation destroyed and clamps malformed display inputs', () => {
    expect(formationStatus(squadron({ aircraft: -2, maxAircraft: 4, readiness: 130, ammo: -4, damaged: -1, status: 'destroyed' }))).toMatchObject({
      aircraft: 0, maxAircraft: 4, aircraftFraction: 0, destroyed: true,
      readiness: 100, ammo: 0, damaged: 0, status: 'destroyed',
    })
  })

  it('updates the displayed aircraft count after a replacement flight', () => {
    const result = {
      ...createMatch().lastResult,
      reinforcementCalls: [],
      squadrons: [squadron({ aircraft: 2 })],
      events: [],
    } as never
    const reinforced = callReinforcement(result, 'replacement-flight', 1, [0, 0])
    expect(formationStatus(reinforced.squadrons[0])).toMatchObject({ aircraft: 3, maxAircraft: 4, aircraftFraction: .75 })
  })

  it('keeps aircraft count authoritative while repair restores one aircraft', () => {
    const state = createMatch()
    state.logistics = 10
    state.squadrons = state.squadrons.map(s => s.id === 'viper' ? { ...s, aircraft: 3, strength: 70, damaged: 0 } : s)
    const repaired = repairSquadron(state, 'viper')
    expect(formationStatus(repaired.squadrons.find(s => s.id === 'viper')!)).toMatchObject({ aircraft: 4, maxAircraft: 4, aircraftFraction: 1 })
  })
})
