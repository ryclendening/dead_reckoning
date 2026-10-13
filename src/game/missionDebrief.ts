import type { MatchState, RoundResult, Squadron } from './types'

export interface MissionOrderDebrief { id:string; callsign:string; purpose:string; result:string }

const distance=(a:[number,number],b:[number,number])=>Math.hypot(a[0]-b[0],a[1]-b[1])

export function missionOrderDebrief(match:MatchState,result:RoundResult):MissionOrderDebrief[]{
  return result.squadrons.filter(squadron=>squadron.sortieOrdered!==false).map(squadron=>{
    const protectedFlight=squadron.protectedTargetId?match.squadrons.find(item=>item.id===squadron.protectedTargetId):undefined
    const protectedAsset=squadron.protectedPoint?match.playerAssets.find(asset=>distance(asset.position,squadron.protectedPoint!)<.02):undefined
    const recovery=result.recoveryOutcomes.find(item=>item.formationId===squadron.id)
    const field=match.playerAssets.find(asset=>asset.id===recovery?.plannedFieldId)
    let purpose=''
    if(squadron.mission==='defensive-cap')purpose=`PROTECT ${protectedFlight?.callsign??protectedAsset?.name??protectedAsset?.kind.toUpperCase()??'MAP POINT'}`
    else if(squadron.mission==='forward-patrol')purpose='PATROL ASSIGNED CORRIDOR'
    else if(squadron.mission==='base-strike')purpose='STRIKE CONFIRMED ENEMY BASE'
    else if(squadron.mission==='transit')purpose=`TRANSIT TO ${field?.name??(field?.kind==='base'?'HOME BASE':field?.kind.toUpperCase()??'RECOVERY FIELD')}`
    else purpose='SEARCH ASSIGNED ROUTE'

    const related=(title:string)=>result.events.find(event=>event.title===title&&event.detail.includes(squadron.callsign))
    let outcome='NO CONTACTS · ORDER COMPLETED'
    if(squadron.mission==='base-strike'){
      const launch=related('BASE STRIKE LAUNCHED'),failure=related('BASE STRIKE FAILED')
      const strike=result.combatSequences.find(sequence=>sequence.kind==='strike'&&sequence.participantIds.includes(squadron.id))
      outcome=launch?`LAUNCHED · ${strike?.exchanges.reduce((total,exchange)=>total+exchange.damage,0)??0} DAMAGE`:failure?.detail.replace(`${squadron.callsign}: `,'').replace(/\.$/,'')??'RELEASE WINDOW NOT REACHED'
    }else if(squadron.mission==='defensive-cap'||squadron.mission==='forward-patrol'){
      const interceptions=result.events.filter(event=>event.title==='FIGHTER INTERCEPT'&&event.detail.includes(squadron.callsign)).length
      const contactSummary=interceptions?`${interceptions} INTERCEPT${interceptions===1?'':'S'}`:'NO THREAT ENGAGED'
      if(protectedFlight){
        const targetRecovery=result.recoveryOutcomes.find(item=>item.formationId===protectedFlight.id)?.outcome
        const targetResult=targetRecovery==='recovered'||targetRecovery==='diverted'?'FRIENDLY FLIGHT RECOVERED':targetRecovery==='lost'||targetRecovery==='destroyed'?'FRIENDLY FLIGHT LOST':'FRIENDLY FLIGHT OUTCOME UNRESOLVED'
        outcome=`${targetResult} · ${contactSummary}`
      }else if(squadron.mission==='defensive-cap'&&protectedAsset?.kind==='base'){
        const baseResult=result.baseDamage>0?`HOME BASE −${result.baseDamage} HEALTH`:result.baseExposureDelta>0?`HOME EXPOSURE +${result.baseExposureDelta}`:'NO HOME BASE DAMAGE'
        outcome=`${baseResult} · ${contactSummary}`
      }else outcome=contactSummary
    }else if(squadron.role==='recon'){
      const reports=result.intelReports.filter(report=>report.observerId===squadron.id)
      const recovered=reports.filter(report=>report.recovered).length,lost=reports.length-recovered
      outcome=recovered?`${recovered} INTEL REPORT${recovered===1?'':'S'} RECOVERED`:lost?`${lost} OBSERVATION${lost===1?'':'S'} LOST`:'NO INTEL COLLECTED'
    }else if(squadron.mission==='transit'){
      const recovery=result.recoveryOutcomes.find(item=>item.formationId===squadron.id)
      outcome=recovery?.outcome==='recovered'||recovery?.outcome==='diverted'?'RECOVERED':recovery?.outcome==='trapped'?'COULD NOT LAUNCH':recovery?.outcome==='lost'?'LOST':'RECOVERY UNRESOLVED'
    }
    const attrition=result.friendlyAttrition.find(item=>item.id===squadron.id)
    if(attrition?.destroyed)outcome=`FORMATION LOST · ${outcome}`
    return {id:squadron.id,callsign:squadron.callsign,purpose,result:outcome}
  })
}
