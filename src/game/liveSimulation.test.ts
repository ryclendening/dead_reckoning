import {describe,expect,it} from 'vitest'
import {createRoundSimulation,resolveRound,TICK_SECONDS} from './engine'
import {createScenario} from './scenarios'
import type {SimulationCommand} from './types'

describe('incremental round simulation',()=>{
  it('produces the same deterministic result as the synchronous compatibility resolver',()=>{
    const state=createScenario('fighter-duel')
    const simulation=createRoundSimulation(structuredClone(state))
    while(!simulation.complete)simulation.advance()
    expect(simulation.result).toEqual(resolveRound(structuredClone(state)))
  })

  it('exposes only completed fixed ticks instead of precomputing the visualization',()=>{
    const simulation=createRoundSimulation(createScenario('recon-recovery'))
    expect(simulation.complete).toBe(false)
    expect(simulation.nextTick()).toBe(1)
    expect(simulation.result.unitTracks.every(track=>track.frames.length===1)).toBe(true)

    simulation.advance()

    expect(simulation.nextTick()).toBe(2)
    expect(simulation.result.duration).toBe(TICK_SECONDS)
    expect(simulation.complete).toBe(false)
  })

  it('accepts an RTB command during execution and changes only subsequent recon behavior',()=>{
    const simulation=createRoundSimulation(createScenario('recon-recovery'))
    for(let tick=0;tick<20;tick+=1)simulation.advance()
    expect(simulation.result.behaviorIntervals.some(interval=>interval.unitId==='raven'&&interval.reason==='player-rtb')).toBe(false)

    const command:SimulationCommand={id:'rtb-live-raven',unitId:'raven',type:'rtb',issuedAtTick:simulation.nextTick()}
    simulation.advance([command])

    const rtb=simulation.result.behaviorIntervals.find(interval=>interval.unitId==='raven'&&interval.reason==='player-rtb')
    expect(rtb?.start).toBeCloseTo(command.issuedAtTick*TICK_SECONDS,8)
    expect(simulation.result.simulationCommands).toEqual([command])
    expect(simulation.result.events.some(event=>event.title==='RTB ORDERED')).toBe(true)
  })

  it('replays a timestamped command schedule deterministically',()=>{
    const state=createScenario('recon-recovery')
    const command:SimulationCommand={id:'rtb-replay-raven',unitId:'raven',type:'rtb',issuedAtTick:20}
    expect(resolveRound(structuredClone(state),[command])).toEqual(resolveRound(structuredClone(state),[command]))
  })
})
