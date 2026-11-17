import {describe,expect,it} from 'vitest'
import {createRoundSimulation,resolveRound,TICK_SECONDS} from './engine'
import {createScenario} from './scenarios'
import {createMatch} from './data'
import type {Point, SimulationCommand} from './types'

describe('shared real-time reaction lifecycle',()=>{
  it('interrupts recon pursuit for direct fighter combat without restoring hidden pursuit intent',()=>{
    const result=resolveRound(createScenario('reaction-interrupt'))
    const pursuit=result.combatSequences.find(sequence=>sequence.kind==='pursuit')
    const dogfight=result.combatSequences.find(sequence=>sequence.kind==='dogfight')
    expect(pursuit).toBeDefined()
    expect(dogfight).toBeDefined()
    expect(result.events.some(event=>event.title==='PURSUIT INTERRUPTED')).toBe(true)
    expect(pursuit!.end).toBe(dogfight!.start)

    const viper=result.behaviorIntervals.filter(interval=>interval.unitId==='viper')
    const interrupted=viper.find(interval=>interval.mode==='attacking-recon')
    expect(interrupted?.end).toBe(dogfight!.start)
    expect(viper.some(interval=>interval.mode==='dogfighting'&&interval.start===dogfight!.start)).toBe(true)
    expect(viper.every(interval=>interval.mode!=='attacking-recon'||interval.end<=dogfight!.start||interval.start>=dogfight!.end)).toBe(true)
    for(const reacquired of viper.filter(interval=>interval.mode==='attacking-recon'&&interval.start>=dogfight!.end))expect(result.contactIntervals.some(contact=>contact.observerId==='viper'&&contact.targetId===reacquired.targetId&&contact.start<=reacquired.start&&contact.end>=reacquired.start)).toBe(true)

    const reconTrack=result.unitTracks.find(track=>track.unitId==='red-recon')!
    const duringCombat=reconTrack.frames.filter(frame=>frame.time>=dogfight!.start&&frame.time<=dogfight!.end)
    expect(new Set(duringCombat.map(frame=>frame.position.map(value=>value.toFixed(3)).join(':'))).size).toBeGreaterThan(1)
  })

  it('lets both fighters shoot on a direct return-leg pass without merging',()=>{
    const state=createMatch()
    const home:Point=[-10,0], opposingHome:Point=[8.4,3]
    const outbound:Point[]=[home,[0,0]]
    const crossing:Point[]=[opposingHome,[-3,3],[-5,0],[-7,0],opposingHome]
    state.playerAssets=state.playerAssets.filter(asset=>asset.kind==='base').map(asset=>({...asset,position:home}))
    state.enemyAssets=state.enemyAssets.filter(asset=>asset.kind==='base').map(asset=>({...asset,position:opposingHome}))
    state.squadrons=state.squadrons.map(formation=>formation.id==='viper'
      ? {...formation,mission:'forward-patrol',sortieOrdered:true,route:outbound,routeIngress:outbound,plannedRecoveryFieldId:'p-base'}
      : {...formation,sortieOrdered:false})
    state.cpu!.plan={round:state.round,objective:'defend',reason:'Scripted crossing',candidates:[],
      orders:state.cpu!.formations.map(formation=>formation.id==='red-fighter'
        ? {...formation,mission:'transit',sortieOrdered:true,route:crossing,routeIngress:crossing,plannedRecoveryFieldId:'e-base'}
        : {...formation,sortieOrdered:false})}
    const result=resolveRound(state)
    const shots=result.combatSequences.filter(sequence=>sequence.kind==='flyby').flatMap(sequence=>sequence.exchanges)
    expect(shots).toHaveLength(2)
    expect(shots.map(shot=>shot.attackerId).sort()).toEqual(['red-fighter','viper'])
    expect(shots[0].time).toBe(shots[1].time)
    expect(result.combatSequences.some(sequence=>sequence.kind==='dogfight')).toBe(false)
    expect(result.recoveryOutcomes.find(outcome=>outcome.formationId==='viper')?.outcome).toBe('recovered')
  })

  it('resolves independent dogfights concurrently without duplicate ownership',()=>{
    const result=resolveRound(createScenario('parallel-engagements'))
    const dogfights=result.combatSequences.filter(sequence=>sequence.kind==='dogfight')
    expect(dogfights).toHaveLength(2)
    expect(Math.max(dogfights[0].start,dogfights[1].start)).toBeLessThan(Math.min(dogfights[0].end,dogfights[1].end))
    if(dogfights[0].kind!=='dogfight'||dogfights[1].kind!=='dogfight')throw new Error('Expected dogfights.')
    for(const id of dogfights[0].participantIds.filter(id=>dogfights[1].participantIds.includes(id))){
      const first=dogfights[0].engagement.participants.find(participant=>participant.id===id)!
      const second=dogfights[1].engagement.participants.find(participant=>participant.id===id)!
      expect(first.exitedAt<=second.joinedAt||second.exitedAt<=first.joinedAt).toBe(true)
    }
  })

  it('keeps an RTB order authoritative while an existing pursuit resolves',()=>{
    const simulation=createRoundSimulation(createScenario('recon-pursuit'))
    while(!simulation.complete&&!simulation.result.events.some(event=>event.title==='RECON UNDER PURSUIT'&&event.detail.includes('RAVEN')))simulation.advance()
    expect(simulation.complete).toBe(false)
    for(let tick=0;tick<5;tick+=1)simulation.advance()
    const command:SimulationCommand={id:'rtb-under-pursuit',unitId:'raven',type:'rtb',issuedAtTick:simulation.nextTick()}
    simulation.advance([command])
    while(!simulation.complete)simulation.advance()

    const rtb=simulation.result.behaviorIntervals.find(interval=>interval.unitId==='raven'&&interval.reason==='player-rtb')
    const pursuit=simulation.result.combatSequences.find(sequence=>sequence.kind==='pursuit')
    expect(rtb?.start).toBeCloseTo(command.issuedAtTick*TICK_SECONDS,8)
    expect(pursuit?.end).toBeGreaterThan(rtb!.start)
    expect(simulation.result.weaponEffects.some(effect=>effect.targetId==='raven'&&effect.start<rtb!.start&&effect.end>rtb!.start)).toBe(true)
    expect(simulation.result.behaviorIntervals.some(interval=>interval.unitId==='raven'&&interval.start>rtb!.start&&interval.mode==='following-route')).toBe(false)
  })

  it('replays concurrent and interrupted engagements deterministically',()=>{
    for(const scenario of ['reaction-interrupt','parallel-engagements'] as const){
      const state=createScenario(scenario)
      expect(resolveRound(structuredClone(state))).toEqual(resolveRound(structuredClone(state)))
    }
  })
})
