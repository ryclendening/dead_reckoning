import {contactProjectionAt,contactTrackIdAt,sampleUnitTrack,unitTrackFor} from './executionProjection'
import type {EnemyFlight,Point,RoundResult} from './types'

export function identifiedAircraftType(flight:Pick<EnemyFlight,'role'>){
  return flight.role==='fighter'?'MiG-23 · FIGHTER':'RECON AIRCRAFT'
}

export interface ContactTrack {
  unitId:string
  trackId:string
  identification:string
  callsign?:string
  visibility:'radar'|'visual'|'lost'
  lastSeen:number
  position:Point
  course:'INBOUND'|'OUTBOUND'|'CROSSING'|'STATIONARY'|'COURSE UNKNOWN'
  aircraft?:number
}

/** Keeps knowledge after contact loss without reading a hidden current pose. */
export function contactTracksAt(result:RoundResult|undefined,seconds:number,home:Point):ContactTrack[]{
  if(!result)return []
  const acquiredIds=new Set(result.contactIntervals.filter(interval=>interval.start<=seconds).map(interval=>interval.targetId))
  return [...acquiredIds].flatMap(unitId=>{
    const flight=result.enemyFlights.find(flight=>flight.id===unitId),track=unitTrackFor(result,unitId)
    if(!flight||!track)return []
    const intervals=result.contactIntervals.filter(interval=>interval.targetId===unitId&&interval.start<=seconds)
    const contact=contactProjectionAt(result,unitId,seconds)
    const lastSeen=contact?seconds:Math.max(...intervals.map(interval=>Math.min(seconds,interval.end)))
    const frame=sampleUnitTrack(track,lastSeen)
    if(!frame)return []
    const windowStart=contact?.visibleSince??Math.min(...intervals.filter(interval=>interval.end>=lastSeen).map(interval=>interval.start))
    const previous=track.frames.filter(frame=>frame.time>=windowStart&&frame.time<lastSeen).at(-1)
    const elapsed=previous?lastSeen-previous.time:0
    const movement=previous?Math.hypot(frame.position[0]-previous.position[0],frame.position[1]-previous.position[1]):0
    const radialSpeed=previous&&elapsed>0?(Math.hypot(frame.position[0]-home[0],frame.position[1]-home[1])-Math.hypot(previous.position[0]-home[0],previous.position[1]-home[1]))/elapsed:0
    const identityKnown=intervals.some(interval=>interval.source==='visual')
    return [{unitId,trackId:contactTrackIdAt(result,unitId,seconds)!,
      identification:identityKnown?identifiedAircraftType(flight):'UNKNOWN AIRCRAFT',
      ...(identityKnown?{callsign:flight.callsign}:{}),
      visibility:contact?.level??'lost',lastSeen,position:frame.position,
      course:!previous?'COURSE UNKNOWN':movement<1e-5?'STATIONARY':radialSpeed<-.15?'INBOUND':radialSpeed>.15?'OUTBOUND':'CROSSING',
      ...(contact?.level==='visual'?{aircraft:frame.aircraft}:{})} satisfies ContactTrack]
  })
}
