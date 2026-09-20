import {describe,expect,it} from 'vitest'
import {applyRound,MAX_FLIGHT_DISTANCE,resolveRound} from './engine'
import {createScenario} from './scenarios'
import {beginNextRound,openAdaptPhase} from './economy'
import {deriveRecoveryPlanningView} from './forwardBasing'

describe('deterministic debug scenarios',()=>{
  it('keeps scenario routes and editable ingresses synchronized',()=>{
    for(const scenario of ['fighter-duel','fighter-2v1','fighter-tail','fighter-head-on','fighter-reversed','fighter-recon','neutral-los','radar-intercept','recon-recovery','recon-edge','recon-loss'] as const){
      const match=createScenario(scenario)
      const selected=match.squadrons.find(squadron=>squadron.id===match.selectedId)!
      expect(selected.aircraft).toBeGreaterThan(0)
      expect(selected.routeIngress).toEqual(selected.route)
      expect(selected.mission).toBe(selected.role==='fighter'?'forward-patrol':'search-area')
    }
  })

  it('resolves full-round positional fixtures from authoritative fighter movement',()=>{
    for(const [scenario,classification] of [['fighter-tail','dominant'],['fighter-head-on','neutral'],['fighter-reversed','disadvantaged']] as const){
      const sequence=resolveRound(createScenario(scenario)).combatSequences.find(item=>item.kind==='dogfight')
      if(!sequence||sequence.kind!=='dogfight')throw new Error(`Expected a dogfight for ${scenario}.`)
      expect(sequence.engagement.positionalAssessments.find(assessment=>assessment.participantId==='viper')?.classification).toBe(classification)
      expect(sequence.exchanges.filter(exchange=>exchange.phase==='opening-fire')).toHaveLength(1)
    }
  })

  it('isolates the fighter 2 vs 1 fixture to three active fighter formations',()=>{
    const result=resolveRound(createScenario('fighter-2v1'))
    expect(result.squadrons.filter(squadron=>squadron.aircraft>0||squadron.status==='destroyed').filter(squadron=>squadron.role==='fighter').map(squadron=>squadron.id)).toEqual(expect.arrayContaining(['viper','falcon']))
    expect(result.enemyFlights.find(flight=>flight.id==='red-recon')?.initialAircraft).toBe(0)
    expect(result.events.some(event=>event.detail.includes('SPECTER'))).toBe(false)
  })

  it('recovers new fixed-asset intelligence in the recon recovery fixture',()=>{
    const match=createScenario('recon-recovery'),result=resolveRound(match)
    expect(result.squadrons.find(squadron=>squadron.id==='raven')?.status).toBe('rtb')
    expect(result.intelReports.some(report=>report.recovered)).toBe(true)
    expect(applyRound(match,result).enemyAssets.some(asset=>asset.intel==='confirmed')).toBe(true)
  })

  it('recovers an exact boundary segment in the recon edge fixture',()=>{
    const match=createScenario('recon-edge'),result=resolveRound(match)
    expect(result.squadrons.find(squadron=>squadron.id==='raven')?.status).toBe('rtb')
    expect(result.discoveredBoundaries.length).toBeGreaterThan(0)
    expect(result.events.some(event=>event.title==='WORLD EDGE DISCOVERED')).toBe(true)
    expect(applyRound(match,result).discoveredBoundaries).toEqual(result.discoveredBoundaries)
  })

  it('latches a crossed FOB, lands there, and launches the next round from that physical field',()=>{
    const initial=createScenario('fob-recovery')
    const base=initial.playerAssets.find(asset=>asset.id==='p-base')!,fob=initial.playerAssets.find(asset=>asset.id==='p-fob-1')!
    const rawRoute=[base.position,fob.position,[fob.position[0]+4,fob.position[1]]] as [number,number][]
    const planning=deriveRecoveryPlanningView(initial,'viper',rawRoute,MAX_FLIGHT_DISTANCE.fighter)!
    expect(planning.normalizedRoute).toEqual([base.position,fob.position])
    expect(planning.intendedField.id).toBe('p-fob-1')
    const match={...initial,squadrons:initial.squadrons.map(squadron=>squadron.id==='viper'?{...squadron,route:planning.normalizedRoute,routeIngress:planning.normalizedRoute,plannedRecoveryFieldId:planning.intendedField.id}:squadron)}
    const result=resolveRound(match),outcome=result.recoveryOutcomes.find(item=>item.formationId==='viper')!
    expect(outcome).toMatchObject({launchFieldId:'p-base',plannedFieldId:'p-fob-1',actualFieldId:'p-fob-1',outcome:'recovered'})
    expect(result.playerAssets.find(asset=>asset.id==='p-fob-1')?.basedFormationIds).toEqual(['viper'])
    const debrief=applyRound(match,result)
    expect(debrief.playerAssets.find(asset=>asset.id==='p-fob-1')?.basedFormationIds).toEqual(['viper'])
    const next=beginNextRound(openAdaptPhase(debrief)),viper=next.squadrons.find(squadron=>squadron.id==='viper')!
    expect(viper.route).toEqual([next.playerAssets.find(asset=>asset.id==='p-fob-1')?.position])
    expect(viper.plannedRecoveryFieldId).toBeUndefined()
  })

  it('diverts deterministically when the intended FOB becomes unusable',()=>{
    const match=createScenario('fob-divert'),first=resolveRound(match),second=resolveRound(match)
    expect(first.recoveryOutcomes.find(item=>item.formationId==='viper')).toMatchObject({plannedFieldId:'p-fob-1',actualFieldId:'p-base',outcome:'diverted'})
    expect(first.events.some(event=>event.title==='RECOVERY DIVERSION')).toBe(true)
    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
  })

  it('holds a stranded formation until fuel exhaustion instead of teleporting it',()=>{
    const result=resolveRound(createScenario('fob-stranded'))
    expect(result.behaviorIntervals.some(interval=>interval.unitId==='viper'&&interval.mode==='stranded')).toBe(true)
    expect(result.recoveryOutcomes.find(item=>item.formationId==='viper')).toMatchObject({outcome:'lost',reason:'fuel-exhaustion',actualFieldId:undefined})
    expect(result.squadrons.find(squadron=>squadron.id==='viper')).toMatchObject({aircraft:0,status:'destroyed'})
  })

  it('keeps aircraft physically trapped at an unusable FOB',()=>{
    const result=resolveRound(createScenario('fob-trapped'))
    expect(result.recoveryOutcomes.find(item=>item.formationId==='viper')).toMatchObject({launchFieldId:'p-fob-1',actualFieldId:'p-fob-1',outcome:'trapped'})
    expect(result.squadrons.find(squadron=>squadron.id==='viper')).toMatchObject({aircraft:4,status:'trapped'})
  })
})
