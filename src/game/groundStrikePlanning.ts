import { buildGroundStrikeRoute } from './routeTemplates'
import type { MatchState, Phase, Squadron } from './types'

/** The Ground Strike task enters map picking; changing targets returns to this same step. */
export function isGroundStrikeTargeting(phase:Phase,squadron:Squadron,step:string):boolean{
  return phase==='plan'&&squadron.role==='fighter'&&squadron.aircraft>0&&squadron.status!=='trapped'&&squadron.mission==='base-strike'&&(step==='target'||step==='idle'&&!squadron.strikeTargetId)
}

/** A strike order can be constructed only after choosing the task and clicking a battlefield target. */
export function planGroundStrike(state:MatchState,formationId:string,targetId:string):Squadron|undefined{
  const squadron=state.squadrons.find(item=>item.id===formationId)
  if(state.phase!=='plan'||!squadron||squadron.mission!=='base-strike'||squadron.status==='trapped')return undefined
  const route=buildGroundStrikeRoute(state,formationId,targetId)
  return route?{...squadron,mission:'base-strike',strikeTargetId:targetId,protectedPoint:undefined,protectedTargetId:undefined,route,routeIngress:route,plannedRecoveryFieldId:undefined}:undefined
}
