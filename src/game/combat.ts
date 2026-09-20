import type {CombatProbabilityRecord,ExecutionStatus,FighterEngagementParticipant,FighterEngagementPhase,FighterEngagementRecord,FighterNumericalAdvantage,FighterNumericalAssessment,FighterPositionalAdvantage,FighterPositionalAssessment,FighterPositionalEvaluation,Point} from './types'

export interface FighterPositionalThresholds {dominant:number;favorable:number;disadvantaged:number;minimumVectorLength:number}
export const FIGHTER_POSITIONAL_THRESHOLDS:FighterPositionalThresholds={dominant:.75,favorable:.3,disadvantaged:-.55,minimumVectorLength:.001}

export interface FighterApproachGeometry {
  participantPosition:Point
  participantHeading:Point
  opponentPosition:Point
  opponentHeading:Point
}

const clamp=(value:number,min=-1,max=1)=>Math.max(min,Math.min(max,value))
const normalized=(vector:Point,minimumLength:number):Point|undefined=>{
  const length=Math.hypot(vector[0],vector[1])
  return length>=minimumLength?[vector[0]/length,vector[1]/length]:undefined
}
const dot=(left:Point,right:Point)=>left[0]*right[0]+left[1]*right[1]

export const FIGHTER_HIT_PROBABILITY_LIMITS={minimum:.1,maximum:.9}
export const FIGHTER_SUSTAINED_GUN_HIT_PROBABILITY=.69
export const FIGHTER_OPENING_MISSILE_HIT_PROBABILITY=.58
export const FIGHTER_OPENING_MISSILE_DAMAGE=32
export const FIGHTER_POSITIONAL_HIT_MODIFIERS:Record<FighterPositionalAdvantage,number>={dominant:.18,favorable:.1,neutral:0,disadvantaged:-.12}
export const FIGHTER_NUMERICAL_THRESHOLDS={overwhelming:1.75,advantaged:1.25,disadvantaged:.8,overmatched:.57}
export const FIGHTER_NUMERICAL_HIT_MODIFIERS:Record<FighterNumericalAdvantage,number>={overwhelming:.1,advantaged:.05,even:0,disadvantaged:-.05,overmatched:-.1}
export interface FighterHitProbabilityModifier {
  source:'position'|'numbers'|'formation-condition'
  key:string
  delta:number
}
export interface FighterHitProbabilityInput {
  baseHitProbability:number
  modifiers?:FighterHitProbabilityModifier[]
}
export type FighterHitProbabilityCalculation=Omit<CombatProbabilityRecord,'roll'>

/** Computes a bounded fighter hit chance without consuming simulation RNG. */
export function calculateFighterHitProbability(input:FighterHitProbabilityInput):FighterHitProbabilityCalculation{
  const modifiers=(input.modifiers??[]).map(modifier=>({...modifier}))
  const unclampedHitProbability=input.baseHitProbability+modifiers.reduce((total,modifier)=>total+modifier.delta,0)
  return {
    baseHitProbability:input.baseHitProbability,
    modifiers,
    unclampedHitProbability,
    finalHitProbability:Math.max(FIGHTER_HIT_PROBABILITY_LIMITS.minimum,Math.min(FIGHTER_HIT_PROBABILITY_LIMITS.maximum,unclampedHitProbability)),
  }
}

/** Resolves an already-consumed normalized seeded roll against a fighter hit chance. */
export function resolveFighterHitProbability(input:FighterHitProbabilityInput,roll:number):{hit:boolean;probability:CombatProbabilityRecord}{
  const calculation=calculateFighterHitProbability(input)
  const normalizedRoll=Math.max(0,Math.min(1,roll))
  return {hit:normalizedRoll<calculation.finalHitProbability,probability:{...calculation,roll:normalizedRoll}}
}

/** Converts living formation strength into comparable side combat power. */
export function calculateFighterSidePower(participants:Array<{strength:number}>):number{
  return participants.reduce((total,participant)=>total+Math.max(0,Math.min(100,participant.strength))/100,0)
}

/** Evaluates bounded numerical advantage without consuming simulation RNG. */
export function evaluateFighterNumericalAdvantage(attackerPower:number,defenderPower:number):FighterNumericalAssessment{
  const attacker=Math.max(0,attackerPower),defender=Math.max(0,defenderPower)
  const forceRatio=defender>0?attacker/defender:attacker>0?FIGHTER_NUMERICAL_THRESHOLDS.overwhelming:1
  const classification: FighterNumericalAdvantage=forceRatio>=FIGHTER_NUMERICAL_THRESHOLDS.overwhelming?'overwhelming':forceRatio>=FIGHTER_NUMERICAL_THRESHOLDS.advantaged?'advantaged':forceRatio>FIGHTER_NUMERICAL_THRESHOLDS.disadvantaged?'even':forceRatio>FIGHTER_NUMERICAL_THRESHOLDS.overmatched?'disadvantaged':'overmatched'
  return {attackerPower:attacker,defenderPower:defender,forceRatio,classification,hitProbabilityDelta:FIGHTER_NUMERICAL_HIT_MODIFIERS[classification]}
}

export function selectFighterOpeningAttacker(first:{id:string;evaluation:FighterPositionalEvaluation},second:{id:string;evaluation:FighterPositionalEvaluation},tieRoll:number):string{
  const difference=first.evaluation.score-second.evaluation.score
  if(Math.abs(difference)>.000001)return difference>0?first.id:second.id
  return tieRoll<.5?first.id:second.id
}

/**
 * Evaluates fighter aspect from authoritative direction vectors. Callers must
 * derive headings from movement state (for example, recent route vectors),
 * never from renderer rotation.
 */
export function evaluateFighterPositionalAdvantage(geometry:FighterApproachGeometry,thresholds:FighterPositionalThresholds=FIGHTER_POSITIONAL_THRESHOLDS):FighterPositionalEvaluation{
  const toOpponent=normalized([geometry.opponentPosition[0]-geometry.participantPosition[0],geometry.opponentPosition[1]-geometry.participantPosition[1]],thresholds.minimumVectorLength)
  const participantHeading=normalized(geometry.participantHeading,thresholds.minimumVectorLength)
  const opponentHeading=normalized(geometry.opponentHeading,thresholds.minimumVectorLength)
  if(!toOpponent||!participantHeading||!opponentHeading)return {classification:'neutral',score:0,approachAlignment:0,targetRearAspect:0,usableHeadings:false}
  const approachAlignment=clamp(dot(participantHeading,toOpponent))
  const targetRearAspect=clamp(dot(opponentHeading,toOpponent))
  const score=clamp((approachAlignment+targetRearAspect)/2)
  const classification=score>=thresholds.dominant?'dominant':score>=thresholds.favorable?'favorable':score<=thresholds.disadvantaged?'disadvantaged':'neutral'
  return {classification,score,approachAlignment,targetRearAspect,usableHeadings:true}
}

export interface FighterEngagementParticipantInput {
  id:string
  side:FighterEngagementParticipant['side']
  joinedAt:number
  exitedAt:number
  initialStrength:number
  finalStrength:number
  initialAircraft:number
  finalAircraft:number
  finalDisposition:ExecutionStatus
}

interface CreateFighterEngagementRecordInput {
  start:number
  end:number
  participants:FighterEngagementParticipantInput[]
  phases?:FighterEngagementPhase[]
  positionalAssessments?:FighterPositionalAssessment[]
}

const copyParticipant=(participant:FighterEngagementParticipantInput):FighterEngagementParticipant=>({...participant})
const copyPhase=(phase:FighterEngagementPhase):FighterEngagementPhase=>({...phase})
const copyAssessment=(assessment:FighterPositionalAssessment):FighterPositionalAssessment=>({...assessment,participantPosition:[...assessment.participantPosition],participantHeading:[...assessment.participantHeading],opponentPosition:[...assessment.opponentPosition],opponentHeading:[...assessment.opponentHeading]})

export function createFighterEngagementRecord(input:CreateFighterEngagementRecordInput):FighterEngagementRecord{
  const participants=input.participants.map(copyParticipant)
  const ids=new Set(participants.map(participant=>participant.id))
  if(ids.size!==participants.length)throw new Error('Fighter engagement participant IDs must be unique.')
  if(!participants.some(participant=>participant.side==='friendly')||!participants.some(participant=>participant.side==='hostile'))throw new Error('Fighter engagement requires participants on both sides.')
  if(input.end<input.start)throw new Error('Fighter engagement cannot end before it starts.')
  const phases=(input.phases??[{kind:'merged',start:input.start,end:input.end},{kind:'resolved',start:input.end,end:input.end}]).map(copyPhase)
  if(phases.some(phase=>phase.start<input.start||phase.end>input.end||phase.end<phase.start))throw new Error('Fighter engagement phase lies outside the engagement timeline.')
  return {
    schemaVersion:1,
    sides:{friendly:participants.filter(participant=>participant.side==='friendly').map(participant=>participant.id),hostile:participants.filter(participant=>participant.side==='hostile').map(participant=>participant.id)},
    participants,
    phases,
    positionalAssessments:(input.positionalAssessments??[]).map(copyAssessment),
  }
}
