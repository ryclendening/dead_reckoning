import type {CombatExchange,FighterCombatSequence,FighterEngagementParticipant} from './types'

export type FighterEngagementPresentationStage='opening-fire'|'merged'|'resolved'
export type FighterEngagementCueTone='neutral'|'friendly'|'hostile'|'warning'

export interface FighterEngagementPresentation {
  stage:FighterEngagementPresentationStage
  friendlyCount:number
  hostileCount:number
  /** Persistent engagement state shown beneath any short-lived event cue. */
  label:string
  /** Short-lived, smoothly faded event derived from the recorded timeline. */
  eventCue?:'FIRST STRIKE'|'HIT'|'MISS'|'MERGE'|'FIGHTER JOINS'|'FORMATION LOST'|'DOGFIGHT ENDS'
  eventCueOpacity:number
  eventCueTone:FighterEngagementCueTone
  /** Context for opening position or the current numerical advantage. */
  contextCue?:string
  numericalCue?:'FRIENDLY ADVANTAGE'|'HOSTILE ADVANTAGE'
  presentationOpacity:number
}

const EVENT_CUE_SECONDS=.58
const RESOLVED_CUE_SECONDS=.7
const CUE_FADE_SECONDS=.12

const clamp01=(value:number)=>Math.max(0,Math.min(1,value))
const activeAt=(participant:FighterEngagementParticipant,seconds:number)=>seconds>=participant.joinedAt&&(participant.finalDisposition!=='destroyed'||seconds<participant.exitedAt)&&seconds<=participant.exitedAt
const fadeWindow=(seconds:number,start:number,end:number)=>{
  if(seconds<start||seconds>end)return 0
  return Math.min(clamp01((seconds-start)/CUE_FADE_SECONDS),clamp01((end-seconds)/CUE_FADE_SECONDS))
}
const latestAt=<T extends {time:number}>(items:T[],seconds:number)=>items.filter(item=>item.time<=seconds).at(-1)
const openingExchange=(sequence:FighterCombatSequence)=>sequence.exchanges.find(exchange=>exchange.phase==='opening-fire')
const participantLossAt=(sequence:FighterCombatSequence,exchange:CombatExchange)=>sequence.engagement.participants.some(participant=>participant.id===exchange.defenderId&&participant.finalDisposition==='destroyed'&&Math.abs(participant.exitedAt-exchange.time)<.001)

function numericalCueAt(sequence:FighterCombatSequence,seconds:number){
  const exchange=latestAt(sequence.exchanges.filter(item=>item.phase==='merged'&&item.numericalAssessment),seconds)
  if(!exchange?.numericalAssessment)return undefined
  const attackerFriendly=sequence.engagement.sides.friendly.includes(exchange.attackerId)
  const friendlyDelta=(attackerFriendly?1:-1)*exchange.numericalAssessment.hitProbabilityDelta
  return friendlyDelta>=.05?'FRIENDLY ADVANTAGE' as const:friendlyDelta<=-.05?'HOSTILE ADVANTAGE' as const:undefined
}

/**
 * Translates the immutable authoritative engagement record into replay-only UI
 * state. It never recalculates combat, mutates the sequence, or changes schema.
 */
export function fighterEngagementPresentationAt(sequence:FighterCombatSequence,seconds:number):FighterEngagementPresentation{
  const participants=sequence.engagement.participants.filter(participant=>activeAt(participant,seconds))
  const friendlyCount=participants.filter(participant=>participant.side==='friendly').length
  const hostileCount=participants.filter(participant=>participant.side==='hostile').length
  const opening=openingExchange(sequence)
  const merged=sequence.engagement.phases.find(phase=>phase.kind==='merged')
  const resolved=seconds>=sequence.end
  const recentJoin=[...sequence.engagement.participants].filter(participant=>participant.joinedAt>sequence.start&&participant.joinedAt<=seconds).sort((left,right)=>left.joinedAt-right.joinedAt).at(-1)

  if(opening&&seconds>=opening.time&&seconds<opening.time+.3){
    const assessment=sequence.engagement.positionalAssessments.find(item=>item.participantId===opening.attackerId)
    return {stage:'opening-fire',friendlyCount,hostileCount,label:'OPENING FIRE',eventCue:opening.hit?'HIT':'MISS',eventCueOpacity:fadeWindow(seconds,opening.time,opening.time+.3),eventCueTone:opening.hit?'warning':'neutral',contextCue:assessment?`${assessment.classification.toUpperCase()} POSITION`:undefined,presentationOpacity:1}
  }

  if(recentJoin&&seconds<=recentJoin.joinedAt+EVENT_CUE_SECONDS&&(!merged||seconds<merged.start)){
    return {stage:'opening-fire',friendlyCount,hostileCount,label:'OPENING FIRE',eventCue:'FIGHTER JOINS',eventCueOpacity:fadeWindow(seconds,recentJoin.joinedAt,recentJoin.joinedAt+EVENT_CUE_SECONDS),eventCueTone:recentJoin.side,contextCue:`${friendlyCount}V${hostileCount} FORMATIONS`,presentationOpacity:1}
  }

  if(resolved){
    return {stage:'resolved',friendlyCount,hostileCount,label:'ENGAGEMENT RESOLVED',eventCue:'DOGFIGHT ENDS',eventCueOpacity:fadeWindow(seconds,sequence.end,sequence.end+RESOLVED_CUE_SECONDS),eventCueTone:'neutral',presentationOpacity:clamp01((sequence.end+RESOLVED_CUE_SECONDS-seconds)/CUE_FADE_SECONDS)}
  }

  if(!merged||seconds<merged.start){
    const assessment=sequence.engagement.positionalAssessments.find(item=>item.participantId===opening?.attackerId)
    const impactTime=opening?.time??merged?.start??sequence.end
    return {stage:'opening-fire',friendlyCount,hostileCount,label:'OPENING FIRE',eventCue:'FIRST STRIKE',eventCueOpacity:fadeWindow(seconds,sequence.start,impactTime),eventCueTone:'warning',contextCue:assessment?`${assessment.classification.toUpperCase()} POSITION`:undefined,presentationOpacity:1}
  }

  const label=`${friendlyCount}V${hostileCount} DOGFIGHT`
  const numericalCue=numericalCueAt(sequence,seconds)
  const recentLoss=latestAt(sequence.exchanges.filter(exchange=>exchange.phase==='merged'&&participantLossAt(sequence,exchange)),seconds)
  if(recentLoss&&seconds<=recentLoss.time+EVENT_CUE_SECONDS){
    return {stage:'merged',friendlyCount,hostileCount,label,eventCue:'FORMATION LOST',eventCueOpacity:fadeWindow(seconds,recentLoss.time,recentLoss.time+EVENT_CUE_SECONDS),eventCueTone:sequence.engagement.sides.friendly.includes(recentLoss.defenderId)?'hostile':'friendly',contextCue:numericalCue,numericalCue,presentationOpacity:1}
  }

  if(recentJoin&&seconds<=recentJoin.joinedAt+EVENT_CUE_SECONDS){
    return {stage:'merged',friendlyCount,hostileCount,label,eventCue:'FIGHTER JOINS',eventCueOpacity:fadeWindow(seconds,recentJoin.joinedAt,recentJoin.joinedAt+EVENT_CUE_SECONDS),eventCueTone:recentJoin.side,contextCue:numericalCue,numericalCue,presentationOpacity:1}
  }

  if(seconds<=merged.start+EVENT_CUE_SECONDS){
    return {stage:'merged',friendlyCount,hostileCount,label,eventCue:'MERGE',eventCueOpacity:fadeWindow(seconds,merged.start,merged.start+EVENT_CUE_SECONDS),eventCueTone:'warning',contextCue:numericalCue,numericalCue,presentationOpacity:1}
  }

  return {stage:'merged',friendlyCount,hostileCount,label,eventCueOpacity:0,eventCueTone:'neutral',contextCue:numericalCue,numericalCue,presentationOpacity:1}
}
