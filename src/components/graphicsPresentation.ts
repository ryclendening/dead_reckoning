import type { Point, UnitFrame, WeaponEffect } from '../game/types'
import { sampleUnitTrackForRender } from '../game/executionProjection'
import type { UnitTrack } from '../game/types'
import { headingAngle, shortestAngleLerp } from '../game/heading'
export { headingAngle, shortestAngleLerp } from '../game/heading'

export const clamp01=(value:number)=>Math.max(0,Math.min(1,value))
export const lerp=(a:number,b:number,t:number)=>a+(b-a)*t
export const lerpPoint=(a:Point,b:Point,t:number):Point=>[lerp(a[0],b[0],t),lerp(a[1],b[1],t)]

export function interpolateHeading(a:UnitFrame,b:UnitFrame,t:number){
  const from=headingAngle(a.position,a.facing)
  return shortestAngleLerp(from,headingAngle(b.position,b.facing,from),t)
}

export function sampledBank(frames:UnitFrame[],time:number,maxBank=.18){
  if(frames.length<2)return 0
  let after=frames.findIndex(frame=>frame.time>=time)
  if(after<0)after=frames.length-1
  const before=Math.max(0,after-1),next=Math.min(frames.length-1,after)
  if(before===next)return 0
  const elapsed=Math.max(.001,frames[next].time-frames[before].time)
  const turn=Math.atan2(Math.sin(headingAngle(frames[next].position,frames[next].facing)-headingAngle(frames[before].position,frames[before].facing)),Math.cos(headingAngle(frames[next].position,frames[next].facing)-headingAngle(frames[before].position,frames[before].facing)))
  return Math.max(-maxBank,Math.min(maxBank,-turn/elapsed*.035))
}

export function stableUnitPhase(id:string){
  let hash=2166136261
  for(let i=0;i<id.length;i++)hash=Math.imul(hash^id.charCodeAt(i),16777619)
  return ((hash>>>0)/4294967296)*Math.PI*2
}

export function combatManeuver(id:string,time:number,engagementStart:number,engagementEnd:number,footprintScale=1){
  const blendIn=clamp01((time-engagementStart)/.55)
  const blendOut=clamp01((engagementEnd+.55-time)/.55)
  const blend=Math.min(blendIn,blendOut)
  const phase=stableUnitPhase(id)
  const angle=time*2.1+phase
  return {x:Math.sin(angle)*.19*blend*footprintScale,z:Math.cos(angle*.83+phase)*.13*blend*footprintScale,yaw:Math.sin(angle*.65+phase)*.18*blend,bank:Math.sin(angle)*.16*blend,pitch:blend===0?0:Math.cos(angle*.71+phase)*.055*blend,blend}
}

export function combatWindow(track:UnitFrame[],time:number){
  const windows:Array<{start:number;end:number}>=[]
  let start:number|undefined,end:number|undefined
  for(const frame of track){
    if(frame.mode==='dogfighting'){start??=frame.time;end=frame.time}
    else if(start!==undefined){windows.push({start,end:frame.time});start=undefined;end=undefined}
  }
  if(start!==undefined)windows.push({start,end:Infinity})
  return windows.find(window=>time>=window.start&&time<=window.end)
    ??windows.filter(window=>time>=window.start-.55&&time<=window.end+.55).sort((a,b)=>Math.min(Math.abs(time-a.start),Math.abs(time-a.end))-Math.min(Math.abs(time-b.start),Math.abs(time-b.end)))[0]
}

export function weaponPath(effect:WeaponEffect,local:number,target:Point=effect.to){
  const dx=target[0]-effect.from[0],dz=target[1]-effect.from[1],length=Math.hypot(dx,dz)||1
  const isAir=effect.kind==='air-to-air-missile'||effect.kind==='gun'
  const endpoint:Point=effect.hit?target:[target[0]-dz/length*.48,target[1]+dx/length*.48]
  const position=lerpPoint(effect.from,endpoint,clamp01(local))
  const fromHeight=effect.kind==='sam'||effect.kind==='aaa'?.12:.76
  const toHeight=effect.kind==='sam'||effect.kind==='aaa'?.76:.1
  return {endpoint,position,height:isAir?.76:lerp(fromHeight,toHeight,clamp01(local)),isAir}
}

export function weaponTangent(effect:WeaponEffect,local:number,target:Point=effect.to){
  const before=weaponPath(effect,Math.max(0,local-.002),target),after=weaponPath(effect,Math.min(1,local+.002),target)
  const dx=after.position[0]-before.position[0],dy=after.height-before.height,dz=after.position[1]-before.position[1],length=Math.hypot(dx,dy,dz)||1
  return [dx/length,dy/length,dz/length] as const
}

export function weaponTrail(effect:WeaponEffect,local:number,target:Point=effect.to,hitscan=effect.kind==='gun'){
  const current=weaponPath(effect,hitscan?1:local,target),tail=weaponPath(effect,hitscan?0:Math.max(0,local-.22),target)
  return [[tail.position[0]-current.position[0],tail.height-current.height,tail.position[1]-current.position[1]],[0,0,0]] as const
}

export function authorizedWeaponTarget(effect:WeaponEffect,time:number,authoritativeTime:number,track?:UnitTrack,contactStart?:number,authorized=true):Point{
  if(!track||!authorized)return effect.to
  const targetTime=Math.min(time,authoritativeTime,effect.end)
  if(contactStart!==undefined&&contactStart>targetTime)return effect.to
  return sampleUnitTrackForRender(track,targetTime,authoritativeTime,contactStart===undefined?undefined:{contactStart})?.position??effect.to
}

export function weaponVisualLifecycle(effect:WeaponEffect,time:number){
  const elapsed=time-effect.start,hitscan=effect.kind==='gun'
  if(hitscan){
    const burstVisible=elapsed>=0&&elapsed<.18
    return {inFlight:false,trailVisible:burstVisible,burstVisible,launchVisible:false,impactFlashVisible:effect.hit&&elapsed>=0&&elapsed<.24,trailOpacity:clamp01(1-elapsed/.18)}
  }
  const inFlight=time>=effect.start&&time<=effect.end,impactAge=time-effect.end,launchAge=elapsed
  return {inFlight,trailVisible:inFlight,burstVisible:inFlight&&(effect.kind==='aaa'),launchVisible:(effect.kind==='sam'||effect.kind==='aaa')&&launchAge>=0&&launchAge<.14,impactFlashVisible:effect.hit&&impactAge>=0&&impactAge<.24,trailOpacity:1}
}

export function weaponVisibleAt(effect:WeaponEffect,time:number){return time>=effect.start-.14&&time<=effect.end+.32}
