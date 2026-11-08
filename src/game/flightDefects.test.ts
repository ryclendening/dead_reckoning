import {describe,expect,it} from 'vitest'
import {createRoundSimulation,resolveRound,TICK_SECONDS} from './engine'
import {facingAfterMove,headingAngle} from './heading'
import {createScenario} from './scenarios'
import {enemyBaseFor} from './data'
import type {MatchState,RoundResult} from './types'

const latest=(result:RoundResult,id:string)=>result.unitTracks.find(track=>track.unitId===id)!.frames.at(-1)!
const withoutDefenses=(state:MatchState):MatchState=>({...state,
  playerAssets:state.playerAssets.map(asset=>asset.kind==='sam'||asset.kind==='aaa'?{...asset,health:0}:asset),
  enemyAssets:state.enemyAssets.map(asset=>asset.kind==='sam'||asset.kind==='aaa'?{...asset,health:0}:asset),
})

describe('confirmed flight and combat defects',()=>{
  it('retains heading on arrival and subsequent zero-distance movement',()=>{
    const arrived=facingAfterMove([0,0],[1,0],[1,0])
    const stopped=facingAfterMove([1,0],[1,0],arrived)
    expect(headingAngle([1,0],arrived)).toBeCloseTo(Math.PI/2)
    expect(stopped).toEqual(arrived)
  })

  it('records valid headings through waypoints, pursuit, holding, and recovery',()=>{
    for(const scenario of ['fighter-2v1','recon-pursuit','recon-recovery','fob-stranded'] as const){
      const result=resolveRound(createScenario(scenario))
      for(const track of result.unitTracks)for(const frame of track.frames){
        expect(Math.hypot(frame.facing[0]-frame.position[0],frame.facing[1]-frame.position[1]),`${scenario}/${track.unitId}/${frame.time}`).toBeCloseTo(1,8)
      }
    }
  })

  it('excludes destroyed formations from the active roster while preserving their history',()=>{
    const state=createScenario('fighter-2v1');state.seed=1
    state.squadrons.find(squadron=>squadron.id==='viper')!.strength=22
    const simulation=createRoundSimulation(state)
    while(!simulation.complete&&!(latest(simulation.result,'viper').mode==='destroyed'&&simulation.result.activeDogfights?.length))simulation.advance()
    expect(simulation.complete).toBe(false)
    const active=simulation.result.activeDogfights![0]
    expect(active.participantIds).not.toContain('viper')
    expect(active.sides).toEqual({friendly:['falcon'],hostile:['red-fighter']})
    while(!simulation.complete)simulation.advance()
    const completed=simulation.result.combatSequences.find(sequence=>sequence.id===active.id)
    expect(completed?.participantIds).toContain('viper')
    expect(completed?.kind==='dogfight'&&completed.engagement.participants.find(participant=>participant.id==='viper')?.finalDisposition).toBe('destroyed')
  })

  it('reconciles aircraft in the first snapshot and participant record after dogfight exit',()=>{
    const result=resolveRound(createScenario('fighter-2v1'))
    const sequence=result.combatSequences.find(sequence=>sequence.kind==='dogfight')!
    expect(sequence.kind).toBe('dogfight')
    if(sequence.kind!=='dogfight')throw new Error('Expected dogfight')
    const damaged=sequence.engagement.participants.filter(participant=>participant.finalDisposition!=='destroyed'&&participant.finalStrength<75)
    expect(damaged.length).toBeGreaterThan(0)
    for(const participant of damaged){
      const frame=result.unitTracks.find(track=>track.unitId===participant.id)!.frames.find(frame=>frame.time>=participant.exitedAt)!
      expect(frame.mode).not.toBe('dogfighting')
      expect(frame.aircraft).toBe(Math.ceil(frame.strength/25))
      expect(participant.finalAircraft).toBe(frame.aircraft)
    }
  })

  it('launches pursuit missiles on the current tick and applies damage only at their impact',()=>{
    const simulation=createRoundSimulation(withoutDefenses(createScenario('recon-pursuit')))
    simulation.advance()
    const missile=simulation.result.weaponEffects.find(effect=>effect.kind==='air-to-air-missile')!
    expect(missile).toBeDefined()
    expect(missile.hit).toBe(true)
    expect(missile.start).toBeCloseTo(simulation.result.duration,8)
    expect(latest(simulation.result,'raven').strength).toBe(100)
    expect(missile.end/TICK_SECONDS).toBeCloseTo(Math.round(missile.end/TICK_SECONDS),8)
    const plannedDamage=missile.damage
    while(simulation.result.duration<missile.end-TICK_SECONDS/2)simulation.advance()
    const frames=simulation.result.unitTracks.find(track=>track.unitId==='raven')!.frames
    const before=frames.at(-2)!,impact=frames.at(-1)!
    expect(before.time).toBeLessThan(missile.end)
    expect(impact.time).toBeCloseTo(missile.end,8)
    expect(before.strength-impact.strength).toBe(plannedDamage)
    while(!simulation.complete)simulation.advance()
    const shots=simulation.result.combatSequences.filter(sequence=>sequence.kind==='pursuit').flatMap(sequence=>sequence.exchanges)
    const resolved=shots.filter(shot=>shot.weapon==='air-to-air-missile'&&Math.abs(shot.time-missile.end)<1e-8)
    expect(resolved).toHaveLength(1)
    expect(resolved[0].damage).toBe(plannedDamage)
    expect(simulation.result.weaponEffects.filter(effect=>effect.id===missile.id)).toHaveLength(1)
  })

  it('cancels pending pursuit damage and hit flashes when the recon has recovered',()=>{
    const state=withoutDefenses(createScenario('recon-pursuit'))
    const home=state.playerAssets.find(asset=>asset.kind==='base')!.position
    const recon=state.squadrons.find(squadron=>squadron.id==='raven')!
    recon.route=[home,home];recon.routeIngress=recon.route
    const simulation=createRoundSimulation(state)
    simulation.advance()
    const missile=simulation.result.weaponEffects.find(effect=>effect.kind==='air-to-air-missile')!
    expect(missile.hit).toBe(true)
    while(!simulation.complete)simulation.advance()
    const target=latest(simulation.result,'raven')
    expect(target.mode).toBe('recovered')
    expect(target.strength).toBe(100)
    const resolved=simulation.result.weaponEffects.find(effect=>effect.id===missile.id)!
    expect(resolved).toMatchObject({hit:false,damage:0})
    const exchanges=simulation.result.combatSequences.filter(sequence=>sequence.kind==='pursuit').flatMap(sequence=>sequence.exchanges)
    expect(exchanges).toHaveLength(1)
    expect(exchanges[0]).toMatchObject({hit:false,damage:0,targetStrength:100})
  })

  it('cancels a missile when another shot destroys its target first',()=>{
    const state=withoutDefenses(createScenario('recon-pursuit'))
    state.squadrons.find(squadron=>squadron.id==='raven')!.strength=10
    const result=resolveRound(state)
    const missile=result.weaponEffects.find(effect=>effect.kind==='air-to-air-missile')!
    const death=result.unitTracks.find(track=>track.unitId==='raven')!.frames.find(frame=>frame.mode==='destroyed')!
    expect(death.time).toBeLessThan(missile.end)
    expect(missile).toMatchObject({hit:false,damage:0})
    const shots=result.combatSequences.filter(sequence=>sequence.kind==='pursuit').flatMap(sequence=>sequence.exchanges)
    expect(shots.filter(shot=>shot.weapon==='air-to-air-missile')).toHaveLength(1)
    expect(shots.find(shot=>shot.weapon==='air-to-air-missile')).toMatchObject({hit:false,damage:0,targetStrength:0})
  })

  it.each(['interruption','shooter-loss'] as const)('resolves a launched missile once after %s',reason=>{
    const state=withoutDefenses(createScenario('recon-pursuit'))
    const home=state.playerAssets.find(asset=>asset.kind==='base')!.position,enemy=enemyBaseFor(state.world)
    const length=Math.hypot(enemy[0]-home[0],enemy[1]-home[1])
    const ahead=(distance:number):[number,number]=>[home[0]+(enemy[0]-home[0])/length*distance,home[1]+(enemy[1]-home[1])/length*distance]
    if(reason==='interruption'){
      const fighter=state.squadrons.find(squadron=>squadron.id==='viper')!
      Object.assign(fighter,{aircraft:4,strength:100,mission:'transit',route:[ahead(2.3),home],routeIngress:[ahead(2.3),home]})
      state.playerAssets.push({id:'p-test-fob',kind:'fob',position:ahead(2.3),intel:'confirmed',confidence:100,health:100,maxHealth:100,hidden:false,struck:false,operational:true,capacity:2,basedFormationIds:['viper']})
      state.playerAssets=state.playerAssets.map(asset=>asset.kind==='base'?{...asset,basedFormationIds:(asset.basedFormationIds??[]).filter(id=>id!=='viper')}:asset)
    }else{
      const aaa=state.playerAssets.find(asset=>asset.kind==='aaa')!
      state.playerAssets.push(...Array.from({length:32},(_,index)=>({...aaa,id:`p-test-aaa-${index}`,health:100,position:ahead(.9)})))
    }
    const result=resolveRound(state)
    const missile=result.weaponEffects.find(effect=>effect.kind==='air-to-air-missile')!
    const pursuit=result.combatSequences.find(sequence=>sequence.kind==='pursuit')!
    expect(missile.hit).toBe(true)
    expect(pursuit.end).toBeLessThan(missile.end)
    if(reason==='interruption')expect(result.combatSequences.find(sequence=>sequence.kind==='dogfight')?.start).toBe(pursuit.end)
    else expect(result.unitTracks.find(track=>track.unitId==='red-fighter')!.frames.find(frame=>frame.mode==='destroyed')!.time).toBe(pursuit.end)
    const impacts=pursuit.exchanges.filter(exchange=>exchange.weapon==='air-to-air-missile')
    expect(impacts).toHaveLength(1)
    expect(impacts[0].time).toBeCloseTo(missile.end,8)
    expect(impacts[0].damage).toBeGreaterThan(0)
    expect(latest(result,'raven').strength).toBe(100-impacts[0].damage)
    expect(result.weaponEffects.filter(effect=>effect.id===missile.id)).toHaveLength(1)
  })
})
