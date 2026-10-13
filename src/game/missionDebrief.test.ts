import { describe, expect, it } from 'vitest'
import { createMatch } from './data'
import { missionOrderDebrief } from './missionDebrief'
import type { RoundResult } from './types'

const blankResult=(squadrons:RoundResult['squadrons']):RoundResult=>({
  round:1,duration:22,tickSeconds:.05,unitTracks:[],contactIntervals:[],behaviorIntervals:[],events:[],squadrons,assets:[],
  enemyLosses:0,friendlyLosses:0,friendlyAttrition:[],enemyAttrition:[],friendlyFormationsDestroyed:0,enemyFormationsDestroyed:0,
  intelGained:[],baseDamage:0,enemyBaseDamage:0,logisticsIncome:{base:0,intel:0,enemyAircraft:0,total:0},command:0,
  executionRoutes:{},enemyFlights:[],defenseCues:[],defensiveAwareness:0,lessons:[],playerAssets:[],reinforcementCalls:[],roundScore:0,
  baseExposure:0,baseExposureDelta:0,combatSequences:[],weaponEffects:[],contactObservations:[],interceptPlans:[],intelReports:[],
  mappedAreas:[],discoveredBoundaries:[],recoveryOutcomes:[],
})

describe('mission order debrief',()=>{
  it('pairs each ordered fighter purpose with its result',()=>{
    const match=createMatch()
    const [fighter]=match.squadrons
    const squadron={...fighter,mission:'base-strike' as const,sortieOrdered:true}
    const result=blankResult([squadron])
    result.events=[{id:'1',time:22,tone:'warning',title:'BASE STRIKE FAILED',detail:`${fighter.callsign}: CONFIRM THE ENEMY BASE BEFORE STRIKING.`}]
    match.squadrons=[squadron]

    expect(missionOrderDebrief(match,result)).toEqual([{
      id:fighter.id,callsign:fighter.callsign,purpose:'STRIKE CONFIRMED ENEMY BASE',result:'CONFIRM THE ENEMY BASE BEFORE STRIKING',
    }])
  })

  it('reports the protected flight recovery separately from intercepts',()=>{
    const match=createMatch(),[fighter,recon]=match.squadrons
    const escort={...fighter,mission:'defensive-cap' as const,protectedTargetId:recon.id,sortieOrdered:true}
    const target={...recon,sortieOrdered:true}
    match.squadrons=[escort,target]
    const result=blankResult(match.squadrons)
    result.recoveryOutcomes=[{formationId:recon.id,launchFieldId:'p-base',plannedFieldId:'p-base',actualFieldId:'p-base',outcome:'recovered',reason:'planned-recovery'}]

    expect(missionOrderDebrief(match,result)[0]).toMatchObject({
      purpose:`PROTECT ${recon.callsign}`,result:'FRIENDLY FLIGHT RECOVERED · NO THREAT ENGAGED',
    })
  })

  it('reports a lost protected flight and home-base damage without implying a successful defense',()=>{
    const match=createMatch(),[fighter,recon]=match.squadrons
    const escort={...fighter,mission:'defensive-cap' as const,protectedTargetId:recon.id,sortieOrdered:true}
    const target={...recon,sortieOrdered:true}
    const result=blankResult([escort,target])
    result.recoveryOutcomes=[{formationId:recon.id,launchFieldId:'p-base',plannedFieldId:'p-base',outcome:'destroyed',reason:'combat-loss'}]
    match.squadrons=[escort,target]
    expect(missionOrderDebrief(match,result)[0].result).toBe('FRIENDLY FLIGHT LOST · NO THREAT ENGAGED')

    const home=match.playerAssets.find(asset=>asset.kind==='base')!
    const guard={...fighter,mission:'defensive-cap' as const,protectedPoint:home.position,sortieOrdered:true}
    result.squadrons=[guard]
    result.baseDamage=40
    match.squadrons=[guard]
    expect(missionOrderDebrief(match,result)[0].result).toBe('HOME BASE −40 HEALTH · NO THREAT ENGAGED')
  })
})
