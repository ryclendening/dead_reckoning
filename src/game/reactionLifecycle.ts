export type ReactionState='mission'|'intercept'|'combat'|'recovering'|'destroyed'

export interface ReactionInput {
  destroyed:boolean
  inDirectCombat:boolean
  recoveryCommanded:boolean
  recoveryRequired:boolean
  actionableTargetId?:string
  missionAvailable:boolean
}

export interface ReactionDecision {
  state:ReactionState
  targetId?:string
  reason:'destroyed'|'direct-combat'|'recovery-commanded'|'recovery-required'|'actionable-contact'|'resume-mission'|'mission-unavailable'
}

/**
 * Shared interruption priority. Mission responsibility is resolved before this
 * function; actionableTargetId must already be authorized by the #29 layer.
 */
export function decideReaction(input:ReactionInput):ReactionDecision{
  if(input.destroyed)return {state:'destroyed',reason:'destroyed'}
  if(input.inDirectCombat)return {state:'combat',reason:'direct-combat'}
  if(input.recoveryCommanded)return {state:'recovering',reason:'recovery-commanded'}
  if(input.recoveryRequired)return {state:'recovering',reason:'recovery-required'}
  if(input.actionableTargetId)return {state:'intercept',targetId:input.actionableTargetId,reason:'actionable-contact'}
  if(input.missionAvailable)return {state:'mission',reason:'resume-mission'}
  return {state:'recovering',reason:'mission-unavailable'}
}
