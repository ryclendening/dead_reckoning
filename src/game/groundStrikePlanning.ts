import { buildGroundStrikeRoute, validateBomberOrderForPlayer } from './routeTemplates'
import { groundStrikeTargets } from './campaign'
import type { MatchState, Phase, Squadron } from './types'

/** The Ground Strike task enters map picking; changing targets returns to this same step. */
export function isGroundStrikeTargeting(phase:Phase,squadron:Squadron,step:string):boolean{
  return phase==='plan'&&squadron.role==='fighter'&&squadron.aircraft>0&&squadron.status!=='trapped'&&squadron.mission==='base-strike'&&(step==='target'||step==='idle'&&!squadron.strikeTargetId)
}
export function isBomberTargeting(phase:Phase,squadron:Squadron,step:string):boolean{
  return phase==='plan'&&squadron.role==='bomber'&&squadron.aircraft>0&&squadron.status!=='trapped'&&squadron.mission==='bomb'&&(step==='target'||step==='idle'&&(squadron.bombingTargets?.length??0)<3)
}

/** A strike order can be constructed only after choosing the task and clicking a battlefield target. */
export function planGroundStrike(state:MatchState,formationId:string,targetId:string):Squadron|undefined{
  const squadron=state.squadrons.find(item=>item.id===formationId)
  if(state.phase!=='plan'||!squadron||squadron.mission!=='base-strike'||squadron.status==='trapped')return undefined
  const route=buildGroundStrikeRoute(state,formationId,targetId)
  return route?{...squadron,mission:'base-strike',strikeTargetId:targetId,protectedPoint:undefined,protectedTargetId:undefined,route,routeIngress:route,recoveryWaypoints:undefined,plannedRecoveryFieldId:undefined}:undefined
}

/** Append a confirmed target and its release anchor to the bomber's ordered route. */
export function planBombingTarget(state:MatchState,formationId:string,targetId:string):Squadron|undefined{
  const squadron=state.squadrons.find(item=>item.id===formationId),target=groundStrikeTargets(state).find(asset=>asset.id===targetId)
  if(state.phase!=='plan'||!squadron||squadron.role!=='bomber'||squadron.mission!=='bomb'||squadron.status==='trapped'||!target)return undefined
  const existing=squadron.bombingTargets??[]
  if(existing.length>=3||existing.some(entry=>entry.targetId===targetId))return undefined
  const routeIndex=squadron.route.length
  const route=[...squadron.route,[...target.position] as [number,number]]
  const order={...squadron,bombingTargets:[...existing,{targetId,routeIndex}],route,routeIngress:route,recoveryWaypoints:undefined,plannedRecoveryFieldId:undefined,strikeTargetId:undefined,protectedPoint:undefined,protectedTargetId:undefined}
  return validateBomberOrderForPlayer(state,order)?undefined:order
}

export function removeBombingTarget(squadron:Squadron,targetId:string):Squadron{
  const index=(squadron.bombingTargets??[]).findIndex(entry=>entry.targetId===targetId)
  if(index<0)return squadron
  const entries=squadron.bombingTargets??[]
  const routeIndex=entries[index].routeIndex
  const route=squadron.route.filter((_point,pointIndex)=>pointIndex!==routeIndex)
  const bombingTargets=entries.filter((_entry,entryIndex)=>entryIndex!==index).map(entry=>({...entry,routeIndex:entry.routeIndex>routeIndex?entry.routeIndex-1:entry.routeIndex}))
  return {...squadron,route,routeIngress:route,bombingTargets:bombingTargets.length?bombingTargets:undefined}
}
