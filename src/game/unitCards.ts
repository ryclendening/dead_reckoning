import { projectFriendlyUnitAt, projectHostileUnitAt } from './executionProjection'
import { samStatusForPhase } from './airDefense'
import type { Asset, EnemyFlight, Phase, RoundResult, Squadron, UnitFrame } from './types'

export interface UnitCardData {
  title:string
  subtitle:string
  health:number
  maxHealth:number
  status:string
  detail?:string
  compact?:{title:string;stat?:string}
}

const ASSET_LABELS:Record<Asset['kind'],string>={base:'MAIN AIRFIELD',fob:'FORWARD AIRFIELD',decoy:'DECOY AIRFIELD',radar:'RADAR SITE',sam:'SAM SITE',aaa:'AAA SITE'}

export function flightActivityLabel(mode?:string){
  return mode==='grounded'?'STATIONED':mode==='dogfighting'||mode==='dogfight'?'DOGFIGHT':mode==='attacking-recon'?'PURSUIT':mode==='intercepting'?'INTERCEPT':mode==='recovering'||mode==='rtb'?'RTB':mode==='recovered'?'LANDED':mode==='destroyed'?'DESTROYED':mode==='trapped'?'TRAPPED':mode==='disengaging'?'BREAKING CONTACT':'ENROUTE'
}

/** Call with the visibility-authorized asset, including provisional observations when currently visible. */
export function assetCardData(asset:Asset,enemy=false,phase:Phase='plan',result?:RoundResult,seconds=0):UnitCardData|undefined{
  if(enemy&&(asset.hidden||asset.intel==='unknown'))return undefined
  const condition=asset.health<=0?'DESTROYED':asset.operational===false?'OFFLINE':asset.health<asset.maxHealth?'DAMAGED':'OPERATIONAL'
  const sam=asset.kind==='sam'?samStatusForPhase(asset.id,phase,result?.weaponEffects,seconds):undefined
  const availability=sam?sam.remaining===0?'EMPTY':sam.cooldown>.001?`COOLDOWN ${sam.cooldown.toFixed(1)}s`:'READY':undefined
  return {title:asset.name??ASSET_LABELS[asset.kind],subtitle:`${ASSET_LABELS[asset.kind]} · ${enemy?asset.intel.toUpperCase():'FRIENDLY'}`,health:asset.health,maxHealth:asset.maxHealth,
    status:condition==='DESTROYED'||condition==='OFFLINE'?condition:sam?`${sam.remaining}/${sam.capacity} MSL · ${availability}`:condition,
    compact:{title:asset.name??(asset.kind==='base'?'BASE':asset.kind.toUpperCase()),stat:asset.health<=0?'LOST':asset.operational===false?'OFF':sam?`${sam.remaining}/${sam.capacity}`:undefined},
    detail:enemy?`${asset.intel.toUpperCase()} INTELLIGENCE · ${asset.confidence}% CONFIDENCE`:undefined}
}

/** Radar tracks retain their separate uncertainty marker and never receive a health/count card. */
export function aircraftCardData(flight:Squadron|EnemyFlight,frame:UnitFrame,visibility:'friendly'|'visual'|'radar',trackId?:string):UnitCardData|undefined{
  if(visibility==='radar')return undefined
  const aircraft=visibility==='friendly'?`${frame.aircraft} / ${'maxAircraft' in flight?flight.maxAircraft:flight.initialAircraft} AC`:`${frame.aircraft} AC`
  const role=visibility==='visual'&&flight.role==='fighter'?'MiG-23':flight.role.toUpperCase()
  return {title:flight.callsign,subtitle:`${trackId?`${trackId} · `:''}${role} · ${aircraft}`,health:frame.strength,maxHealth:100,status:flightActivityLabel(frame.mode),detail:trackId,compact:{title:flight.callsign,stat:`${frame.aircraft} AC`}}
}

/** Inspect only a friendly frame or a currently visual hostile frame; close details when sight is lost. */
export function aircraftInspectionAt(result:RoundResult|undefined,unitId:string,seconds:number){
  const friendly=result?.squadrons.find(flight=>flight.id===unitId)
  if(friendly){const projection=projectFriendlyUnitAt(result,unitId,seconds);return projection?{flight:friendly,frame:projection.frame,visibility:'friendly' as const}:undefined}
  const hostile=result?.enemyFlights.find(flight=>flight.id===unitId)
  const projection=hostile?projectHostileUnitAt(result,unitId,seconds):undefined
  return hostile&&projection?.visibility==='visual'?{flight:hostile,frame:projection.frame,visibility:'visual' as const,trackId:projection.trackId}:undefined
}

/** Match phone-sized canvases in portrait and landscape without relying on a device brand. */
export function usesCompactUnitCards(width:number,height:number):boolean{
  return width<=640||width<=960&&height<=500
}
