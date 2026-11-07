import { buildGroundStrikeRoute } from './routeTemplates'
import type { MatchState, Phase, Squadron } from './types'

/** Map picking survives closing the target menu and stays available during ingress editing. */
export function isGroundStrikeTargeting(phase:Phase,squadron:Squadron,step:string):boolean{
  return phase==='plan'&&squadron.role==='fighter'&&squadron.aircraft>0&&squadron.status!=='trapped'&&squadron.mission==='base-strike'&&(step==='target'||step==='route'||step==='idle'&&!squadron.strikeTargetId)
}

/** A single order constructor for battlefield models/cards, site actions, and the optional target list. */
export function planGroundStrike(state:MatchState,formationId:string,targetId:string):Squadron|undefined{
  const squadron=state.squadrons.find(item=>item.id===formationId)
  if(state.phase!=='plan'||!squadron||squadron.status==='trapped')return undefined
  const route=buildGroundStrikeRoute(state,formationId,targetId)
  return route?{...squadron,mission:'base-strike',strikeTargetId:targetId,protectedPoint:undefined,protectedTargetId:undefined,route,routeIngress:route,plannedRecoveryFieldId:undefined}:undefined
}
