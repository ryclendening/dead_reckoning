import { enemyBaseFor } from './data'
import {calculateFighterSidePower,createFighterEngagementRecord,evaluateFighterNumericalAdvantage,evaluateFighterPositionalAdvantage,FIGHTER_OPENING_MISSILE_DAMAGE,FIGHTER_OPENING_MISSILE_HIT_PROBABILITY,FIGHTER_POSITIONAL_HIT_MODIFIERS,FIGHTER_SUSTAINED_GUN_HIT_PROBABILITY,resolveFighterHitProbability,selectFighterOpeningAttacker} from './combat'
import type { Asset, BehaviorInterval, CombatEvent, CombatExchange, CombatProbabilityRecord, CombatSequence, ContactInterval, ContactObservation, DebugScenario, DefenseCue, EnemyFlight, FighterPositionalAssessment, FlightMode, FormationAttrition, FormationRecoveryOutcome, IntelLevel, IntelReport, InterceptPlan, MatchState, Point, RadarTrackReceipt, ReinforcementCall, ReinforcementType, Role, RoundResult, SimulationCommand, Squadron, ThreatAlert, UnitFrame, WeaponEffect, WeaponKind } from './types'
import { boundarySegmentsObservedAt, intersectMovementWithWorld, mergeBoundarySegments, MAPPED_AREA_RADIUS } from './world'
import { deriveLogisticsIncome, settleLogisticsIncome } from './economy'
import { applyRecoveryOutcomesToBasing, formationField, isOperationalAirfield, nearestReachableAlternate, normalizeFormationBasing, setAirfieldOperational } from './forwardBasing'
import { nearestResponsibleContact } from './missionResponsibility'
import { decideReaction } from './reactionLifecycle'

export const SENSOR_RANGE: Record<Squadron['role'], number>={fighter:4.2,recon:4.9}
export const RADAR_RANGE=6.4
export const RADAR_COMMUNICATION_RANGE=11
export const EXECUTION_SECONDS=22
export const MAX_FLIGHT_DISTANCE:Record<Squadron['role'],number>={fighter:40,recon:48}
const FIGHTER_MERGE_RANGE=1.2
export const REINFORCEMENT_OPTIONS:Record<ReinforcementType,{label:string;scoreCost:number;commandCost:number;reserveCost:number;summary:string}>={
  'alert-cap':{label:'ALERT FIGHTERS',scoreCost:3,commandCost:1,reserveCost:1,summary:'Vector a reserve pair to the current fighter contact.'},
  'replacement-flight':{label:'REPLACEMENT FLIGHT',scoreCost:4,commandCost:1,reserveCost:1,summary:'Restore one observed combat loss for the next round.'},
}
const clamp=(v:number,min=0,max=1)=>Math.max(min,Math.min(max,v))
const distance=(a:Point,b:Point)=>Math.hypot(a[0]-b[0],a[1]-b[1])
const rand=(seed:number)=>{const x=Math.sin(seed)*10000;return x-Math.floor(x)}
const levelFor=(confidence:number):IntelLevel=>confidence>=90?'confirmed':confidence>=65?'probable':confidence>=25?'suspected':'unknown'
const strengthOf=(unit:{strength?:number;aircraft:number;maxAircraft?:number;initialAircraft?:number})=>unit.strength??unit.aircraft/Math.max(1,unit.maxAircraft??unit.initialAircraft??unit.aircraft)*100
const aircraftFor=(strength:number,max:number)=>strength<=0?0:Math.min(max,Math.max(1,Math.ceil(strength/25)))
export function deriveFormationAttrition(starting:Array<Pick<Squadron,'id'|'callsign'|'role'|'aircraft'>>,ending:Array<Pick<Squadron,'id'|'callsign'|'role'|'aircraft'|'strength'|'status'>>,confirmedIds?:Set<string>):FormationAttrition[]{
  return starting.map(start=>{const end=ending.find(candidate=>candidate.id===start.id)??start;const endAircraft=Math.max(0,end.aircraft);const destroyed=start.aircraft>0&&endAircraft===0
    return {id:start.id,callsign:start.callsign,role:start.role,startAircraft:start.aircraft,endAircraft,aircraftLost:Math.max(0,start.aircraft-endAircraft),endStrength:Math.max(0,Math.round(strengthOf(end))),finalStatus:start.aircraft===0?'not-deployed':endAircraft===0?'destroyed':endAircraft<start.aircraft||strengthOf(end)<100?'damaged':'returned',destroyed,confirmed:confirmedIds?.has(start.id)??true}
  })
}
export const effectiveSensorRange=(sq:Squadron)=>SENSOR_RANGE[sq.role]*(.68+.32*clamp(strengthOf(sq)/100))
const ensureRecovery=(route:Point[],base:Point)=>route.length>1&&distance(route.at(-1)!,base)<.35?route:[...route,base]
const sampleRoute=(route:Point[],step=1.15)=>{
  const samples:Point[]=[]
  for(let i=1;i<route.length;i++){
    const from=route[i-1],to=route[i],length=distance(from,to),count=Math.max(1,Math.ceil(length/step))
    for(let j=0;j<=count;j++)samples.push([from[0]+(to[0]-from[0])*j/count,from[1]+(to[1]-from[1])*j/count])
  }
  return samples
}
const mergeMappedAreas=(existing:Point[],next:Point[])=>{
  const seen=new Set<string>();const merged:Point[]=[]
  for(const point of [...existing,...next]){const key=`${Math.round(point[0]*2)}:${Math.round(point[1]*2)}`;if(!seen.has(key)){seen.add(key);merged.push(point)}}
  return merged
}
export const routeDistance=(route:Point[])=>route.slice(1).reduce((sum,point,index)=>sum+distance(route[index],point),0)
export const missionDistance=(route:Point[],base:Point)=>routeDistance(route)+(route.length&&distance(route.at(-1)!,base)>.3?distance(route.at(-1)!,base):0)
export function capRouteForFuel(route:Point[],base:Point,maxDistance:number){
  if(route.length<2)return route
  const capped:Point[]=[route[0]];let traveled=0
  for(const point of route.slice(1)){
    const from=capped.at(-1)!;const segment=distance(from,point)
    if(traveled+segment+distance(point,base)<=maxDistance+.001){capped.push(point);traveled+=segment;continue}
    let low=0,high=1
    for(let i=0;i<24;i++){const t=(low+high)/2;const candidate:[number,number]=[from[0]+(point[0]-from[0])*t,from[1]+(point[1]-from[1])*t];if(traveled+segment*t+distance(candidate,base)<=maxDistance)low=t;else high=t}
    if(low>.01)capped.push([from[0]+(point[0]-from[0])*low,from[1]+(point[1]-from[1])*low])
    break
  }
  return capped
}

function routePoint(route:Point[],progress:number):Point{
  if(route.length<2)return route[0]??[0,0]
  const lengths=route.slice(1).map((point,index)=>distance(route[index],point));const total=lengths.reduce((sum,n)=>sum+n,0)
  let remaining=clamp(progress)*total
  for(let i=0;i<lengths.length;i++){if(remaining<=lengths[i]){const f=lengths[i]===0?0:remaining/lengths[i];return [route[i][0]+(route[i+1][0]-route[i][0])*f,route[i][1]+(route[i+1][1]-route[i][1])*f]}remaining-=lengths[i]}
  return route.at(-1)!
}
function timedRoutePoint(route:Point[],role:Squadron['role'],timeProgress:number){const length=Math.max(.001,routeDistance(route));return routePoint(route,Math.min(1,timeProgress*MAX_FLIGHT_DISTANCE[role]/length))}
function closestRouteProgress(route:Point[],point:Point){let best={distance:Infinity,progress:0,point:route[0]??[0,0] as Point};for(let i=0;i<=80;i++){const progress=i/80;const sample=routePoint(route,progress);const d=distance(sample,point);if(d<best.distance)best={distance:d,progress,point:sample}}return best}
function playerBase(state:MatchState):Point{return state.playerAssets.find(a=>a.kind==='base')?.position??[-7.8,11.2]}
function enemyFlights(state:MatchState):EnemyFlight[]{const fighterRecon=state.debugScenario==='fighter-recon',fobScenario=state.debugScenario?.startsWith('fob-')??false,reconFixture=state.debugScenario?.startsWith('recon-')??false,isolatedTwoVsOne=state.debugScenario==='fighter-2v1',enemyBase=enemyBaseFor(state.world),friendlyBase=playerBase(state);const toward=(factor:number):Point=>[enemyBase[0]+(friendlyBase[0]-enemyBase[0])*factor,enemyBase[1]+(friendlyBase[1]-enemyBase[1])*factor];const fighterTurn=toward(.56),reconTurn=toward(.7);const vector:Point=[enemyBase[0]-friendlyBase[0],enemyBase[1]-friendlyBase[1]],length=Math.max(.001,Math.hypot(vector[0],vector[1])),forward:Point=[vector[0]/length,vector[1]/length],side:Point=[-forward[1],forward[0]];const offset=(ahead:number,lateral=0):Point=>[friendlyBase[0]+forward[0]*ahead+side[0]*lateral,friendlyBase[1]+forward[1]*ahead+side[1]*lateral]
  if(state.debugScenario==='reaction-interrupt')return [
    {id:'red-fighter',callsign:'BOGEY 1',role:'fighter',aircraft:4,initialAircraft:4,strength:100,morale:74,status:'enroute',target:'decoy',route:[offset(5),friendlyBase],detectionWindows:[]},
    {id:'red-recon',callsign:'SPECTER',role:'recon',aircraft:2,initialAircraft:2,strength:100,morale:70,status:'enroute',target:'base',route:[offset(1),offset(16)],detectionWindows:[]},
  ]
  if(state.debugScenario==='parallel-engagements')return [-4,4].map((lateral,index)=>({id:index===0?'red-fighter':'red-fighter-2',callsign:`BOGEY ${index+1}`,role:'fighter' as const,aircraft:4,initialAircraft:4,strength:100,morale:74,status:'enroute' as const,target:'decoy',route:[offset(.9,lateral),friendlyBase],detectionWindows:[]}))
  if(state.debugScenario==='recon-pursuit')return [
    {id:'red-fighter',callsign:'BOGEY 1',role:'fighter',aircraft:4,initialAircraft:4,strength:100,morale:74,status:'enroute',target:'decoy',route:[offset(.9),offset(15)],detectionWindows:[]},
    {id:'red-recon',callsign:'SPECTER',role:'recon',aircraft:0,initialAircraft:0,strength:0,morale:70,status:'destroyed',target:'base',route:[enemyBase,enemyBase],detectionWindows:[]},
  ]
  const geometryRoute=state.debugScenario==='fighter-tail'?[[friendlyBase[0]+.9,friendlyBase[1]] as Point,[friendlyBase[0]+8,friendlyBase[1]] as Point]:state.debugScenario==='fighter-head-on'?[[friendlyBase[0]+.9,friendlyBase[1]] as Point,[friendlyBase[0]-8,friendlyBase[1]] as Point]:state.debugScenario==='fighter-reversed'?[[friendlyBase[0]-.9,friendlyBase[1]] as Point,[friendlyBase[0]+8,friendlyBase[1]] as Point]:undefined;const fighterInactive=fighterRecon||fobScenario||reconFixture;return [
  {id:'red-fighter',callsign:'BOGEY 1',role:'fighter',aircraft:fighterInactive?0:4,initialAircraft:fighterInactive?0:4,strength:fighterInactive?0:100,morale:74,status:fighterInactive?'destroyed':'enroute',target:'decoy',route:geometryRoute??[enemyBase,toward(.27),fighterTurn,toward(.4),fighterTurn,toward(.27),enemyBase],detectionWindows:[]},
  {id:'red-recon',callsign:'SPECTER',role:'recon',aircraft:isolatedTwoVsOne||fobScenario?0:2,initialAircraft:isolatedTwoVsOne||fobScenario?0:2,strength:isolatedTwoVsOne||fobScenario?0:100,morale:70,status:isolatedTwoVsOne||fobScenario?'destroyed':'enroute',target:'base',route:fighterRecon?[enemyBase,toward(.25),toward(.72),friendlyBase,toward(.72),toward(.25),enemyBase]:[enemyBase,toward(.3),reconTurn,toward(.38),reconTurn,toward(.3),enemyBase],detectionWindows:[]},
]}
function damage(unit:{strength?:number;morale?:number;aircraft:number;maxAircraft?:number;initialAircraft?:number},amount:number,updateAircraft=true){const before=unit.aircraft;const max=unit.maxAircraft??unit.initialAircraft??before;unit.strength=Math.max(0,strengthOf(unit)-amount);if(updateAircraft)unit.aircraft=aircraftFor(unit.strength,max);unit.morale=Math.max(0,(unit.morale??70)-8-(updateAircraft&&unit.aircraft<before?18:0));return {before,after:unit.aircraft,strength:unit.strength,morale:unit.morale}}
function weapon(id:string,kind:WeaponKind,sourceId:string,targetId:string,time:number,from:Point,to:Point,hit:boolean,amount:number):WeaponEffect{const travel=kind==='gun'||kind==='aaa' ? .34 : kind==='sam' ? 1.05 : .62;return {id,kind,sourceId,targetId,start:time,end:time+travel,from,to,hit,damage:amount}}

function dogfight(round:number,index:number,friendly:Squadron,hostile:EnemyFlight,location:Point,start:number,seed:number,add:(tone:CombatEvent['tone'],title:string,detail:string,position?:Point,time?:number)=>void){
  const initialFriendly={strength:strengthOf(friendly),aircraft:friendly.aircraft},initialHostile={strength:strengthOf(hostile),aircraft:hostile.aircraft}
  const exchanges:CombatExchange[]=[];const effects:WeaponEffect[]=[];let roll=seed;let friendlyLossReported=false;let hostileLossReported=false
  add('danger','DOGFIGHT MERGED',`${friendly.callsign} and ${hostile.callsign} are committed until one formation is destroyed.`,location,start)
  let i=0
  while(strengthOf(friendly)>0&&strengthOf(hostile)>0&&i<24){
    const friendlyAttacks=rand(roll++)<.54+(friendly.readiness-80)/180;const attacker=friendlyAttacks?friendly:hostile;const defender=friendlyAttacks?hostile:friendly;const kind:WeaponKind=rand(roll++)<.45?'air-to-air-missile':'gun';const hit=rand(roll++)<.72;const amount=hit?(kind==='gun'?Math.round(12+rand(roll++)*7):Math.round(26+rand(roll++)*12)):0;const applied=hit?damage(defender,amount,false):{before:defender.aircraft,after:defender.aircraft,strength:strengthOf(defender),morale:defender.morale??70};const time=start+.35+i*.26
    exchanges.push({id:`fight-${round}-${index}-${i}`,time,attackerId:attacker.id,defenderId:defender.id,weapon:kind,damage:amount,moraleDamage:hit?8:0,hit,position:location,targetStrength:applied.strength,targetMorale:applied.morale})
    effects.push(weapon(`weapon-fight-${round}-${index}-${i}`,kind,attacker.id,defender.id,time-.16,[location[0]+(friendlyAttacks ? -.55 : .55),location[1]+.2],[location[0]+(friendlyAttacks ? .5 : -.5),location[1]-.2],hit,amount))
    if(hit)add(friendlyAttacks?'friendly':'warning','DAMAGE REPORTED',`${defender.callsign} takes ${amount}% formation damage.`,location,time+.18)
    i++
  }
  if(strengthOf(friendly)>0&&strengthOf(hostile)>0){
    const defender=strengthOf(friendly)<=strengthOf(hostile)?friendly:hostile;const attacker=defender===friendly?hostile:friendly;const friendlyAttacks=attacker===friendly;const amount=Math.ceil(strengthOf(defender))+1;const time=start+.35+i*.26;const applied=damage(defender,amount,false);defender.aircraft=0
    exchanges.push({id:`fight-${round}-${index}-${i}`,time,attackerId:attacker.id,defenderId:defender.id,weapon:'air-to-air-missile',damage:amount,moraleDamage:8,hit:true,position:location,targetStrength:applied.strength,targetMorale:applied.morale})
    effects.push(weapon(`weapon-fight-${round}-${index}-${i}`,'air-to-air-missile',attacker.id,defender.id,time-.16,[location[0]+(friendlyAttacks ? -.55 : .55),location[1]+.2],[location[0]+(friendlyAttacks ? .5 : -.5),location[1]-.2],true,amount))
    add(friendlyAttacks?'friendly':'danger',friendlyAttacks?'ENEMY AIRCRAFT LOST':'AIRCRAFT LOST',`${defender.callsign} loses its remaining aircraft.`,location,time+.18);if(friendlyAttacks)hostileLossReported=true;else friendlyLossReported=true
  }
  if(strengthOf(friendly)<=0){friendly.aircraft=0;if(!friendlyLossReported)add('danger','AIRCRAFT LOST',`${friendly.callsign} loses its remaining aircraft.`,location,start+.35+i*.26+.18)}
  if(strengthOf(hostile)<=0){hostile.aircraft=0;if(!hostileLossReported)add('friendly','ENEMY AIRCRAFT LOST',`${hostile.callsign} loses its remaining aircraft.`,location,start+.35+i*.26+.18)}
  friendly.status=strengthOf(friendly)<=0?'destroyed':'rtb';hostile.status=strengthOf(hostile)<=0?'destroyed':'rtb'
  const reason=friendly.status==='destroyed'?`${friendly.callsign} destroyed`: `${hostile.callsign} destroyed`
  const end=start+Math.min(7,Math.max(4.2,exchanges.length*.26+1))
  add(hostile.status==='destroyed'?'friendly':'danger','DOGFIGHT ENDS',reason,location,end-.25)
  const finalDisposition={[friendly.id]:friendly.status,[hostile.id]:hostile.status}
  const engagement=createFighterEngagementRecord({start,end,participants:[
    {id:friendly.id,side:'friendly',joinedAt:start,exitedAt:end,initialStrength:initialFriendly.strength,finalStrength:strengthOf(friendly),initialAircraft:initialFriendly.aircraft,finalAircraft:friendly.aircraft,finalDisposition:friendly.status},
    {id:hostile.id,side:'hostile',joinedAt:start,exitedAt:end,initialStrength:initialHostile.strength,finalStrength:strengthOf(hostile),initialAircraft:initialHostile.aircraft,finalAircraft:hostile.aircraft,finalDisposition:hostile.status},
  ]})
  return {sequence:{id:`dogfight-${round}-${index}`,kind:'dogfight' as const,participantIds:[friendly.id,hostile.id],location,start,end,exchanges,finalDisposition,moraleBreakReason:reason,engagement},effects,roll}
}

function groundDefenseEngagement(params:{round:number;index:number;asset:Asset;target:Squadron|EnemyFlight;route:Point[];friendlyDefense:boolean;seed:number;add:(tone:CombatEvent['tone'],title:string,detail:string,position?:Point,time?:number)=>void}){
  const {round,index,asset,target,route,friendlyDefense,add}=params
  if((asset.kind!=='sam'&&asset.kind!=='aaa')||asset.health<=0||target.aircraft<=0)return undefined
  const track=closestRouteProgress(route,asset.position);const range=asset.kind==='sam'?3.2:1.9
  if(track.distance>range)return undefined
  let roll=params.seed;const kind:WeaponKind=asset.kind;const shots=kind==='sam'?1:5;const start=clamp(track.progress*EXECUTION_SECONDS,3.6,16.5)
  const title=kind==='sam'?'SAM LAUNCH':'AAA FIRING'
  add(friendlyDefense?'friendly':'danger',title,`${kind.toUpperCase()} site opens fire on ${target.callsign}; ${kind==='sam'?'missile inbound':'tracer burst visible'}.`,asset.position,start)
  const exchanges:CombatExchange[]=[];const effects:WeaponEffect[]=[]
  for(let shot=0;shot<shots&&target.aircraft>0;shot++){
    const time=start+shot*(kind==='sam' ? 0 : .22);const hit=rand(roll++)<(kind==='sam' ? .64 : .42);const amount=hit?(kind==='sam'?Math.round(30+rand(roll++)*20):Math.round(7+rand(roll++)*6)):0
    const applied=hit?damage(target,amount):{before:target.aircraft,after:target.aircraft,strength:strengthOf(target),morale:target.morale??70}
    const aim:[number,number]=[track.point[0]+(rand(roll++)-.5)*.35,track.point[1]+(rand(roll++)-.5)*.35]
    const exchange:CombatExchange={id:`defense-${round}-${index}-${shot}`,time,attackerId:asset.id,defenderId:target.id,weapon:kind,damage:amount,moraleDamage:hit?8:0,hit,position:track.point,targetStrength:applied.strength,targetMorale:applied.morale}
    exchanges.push(exchange);effects.push(weapon(`weapon-${exchange.id}`,kind,asset.id,target.id,time,asset.position,aim,hit,amount))
    if(hit&&applied.after<applied.before)add(friendlyDefense?'friendly':'danger',friendlyDefense?'ENEMY AIRCRAFT LOST':'AIRCRAFT LOST',`${target.callsign} loses an aircraft to ${kind.toUpperCase()} fire.`,track.point,time+(kind==='sam'?1.05:.38))
  }
  if(target.aircraft<=0)target.status='destroyed'
  const end=start+(kind==='sam'?1.35:1.55)
  return {sequence:{id:`defense-${round}-${index}`,kind:'defense' as const,participantIds:[asset.id,target.id],location:track.point,start,end,exchanges,finalDisposition:{[target.id]:target.status??'enroute'}},effects,roll}
}

function reconPursuit(round:number,index:number,recon:Squadron,hostile:EnemyFlight,location:Point,start:number,seed:number,add:(tone:CombatEvent['tone'],title:string,detail:string,position?:Point,time?:number)=>void){
  let roll=seed;const exchanges:CombatExchange[]=[];const effects:WeaponEffect[]=[]
  add('warning','RECON UNDER PURSUIT',`${recon.callsign} remains on its collection route while the fighter closes.`,location,start)
  for(let shot=0;shot<4&&recon.aircraft>0;shot++){
    const time=start+.45+shot*.62;const kind:WeaponKind=shot%2===0?'air-to-air-missile':'gun';const hit=rand(roll++)<.58;const amount=hit?(kind==='gun'?Math.round(12+rand(roll++)*7):Math.round(24+rand(roll++)*12)):0;const applied=hit?damage(recon,amount):{before:recon.aircraft,after:recon.aircraft,strength:strengthOf(recon),morale:recon.morale??70}
    const exchange:CombatExchange={id:`pursuit-${round}-${index}-${shot}`,time,attackerId:hostile.id,defenderId:recon.id,weapon:kind,damage:amount,moraleDamage:hit?8:0,hit,position:location,targetStrength:applied.strength,targetMorale:applied.morale}
    exchanges.push(exchange);effects.push(weapon(`weapon-${exchange.id}`,kind,hostile.id,recon.id,time-.18,[location[0]+.55,location[1]-.25],[location[0]-.5,location[1]+.2],hit,amount))
    if(hit&&applied.after<applied.before)add('danger','AIRCRAFT LOST',`${recon.callsign} loses an aircraft while pressing through fighter pursuit.`,location,time+.2)
    else if(hit)add('warning','DAMAGE REPORTED',`${recon.callsign} takes ${amount}% damage but continues collection.`,location,time+.2)
  }
  recon.status=recon.aircraft<=0?'destroyed':'enroute';const end=start+Math.max(3.8,exchanges.length*.62+1)
  add(recon.status==='destroyed'?'danger':'warning',recon.status==='destroyed'?'RECON DESTROYED':'RECON ESCAPES PURSUIT',recon.status==='destroyed'?`${recon.callsign} is destroyed before the report can return.`:`${recon.callsign} opens the distance and continues the mission.`,location,end-.25)
  return {sequence:{id:`pursuit-${round}-${index}`,kind:'pursuit' as const,participantIds:[hostile.id,recon.id],location,start,end,exchanges,finalDisposition:{[recon.id]:recon.status,[hostile.id]:'rtb' as const}},effects,roll}
}

export function battleScoreAt(result:RoundResult,seconds:number){return result.events.reduce((score,event)=>event.time>seconds?score:score+(event.title==='INTEL RECOVERED'?2:event.title==='ENEMY AIRCRAFT LOST'?2:event.title==='DOGFIGHT ENDS'?1:0),0)}
export function attritionCreditAt(result:RoundResult,seconds:number){return result.events.reduce((score,event)=>event.time<=seconds&&(event.title==='AIRCRAFT LOST'||event.title==='ENEMY AIRCRAFT LOST')?score+2:score,0)}
export function supportCreditsAt(result:RoundResult,seconds:number){return Math.max(0,battleScoreAt(result,seconds)+attritionCreditAt(result,seconds)-result.reinforcementCalls.reduce((sum,call)=>sum+call.scoreCost,0))}

type SimUnit={id:string;callsign:string;role:Role;friendly:boolean;position:Point;facing:Point;route:Point[];waypoint:number;mode:FlightMode;targetId?:string;strength:number;morale:number;aircraft:number;maxAircraft:number;traveled:number;frames:UnitFrame[];observed:Set<string>;boundaryObservations:import('./types').BoundarySegment[];source:Squadron|EnemyFlight;launchFieldId?:string;plannedFieldId?:string;recoveryFieldId?:string;recoveryCommanded?:boolean;diverted?:boolean;trapped?:boolean;strandedCenter?:Point;strandedAngle?:number}
type AirContact={target:SimUnit;source:'radar'|'visual'}
type TransitionUnit=(unit:SimUnit,mode:FlightMode,time:number,reason:string,targetId?:string,source?:'radar'|'visual')=>void
type AddCombatEvent=(tone:CombatEvent['tone'],title:string,detail:string,position?:Point,time?:number)=>void
type EngagementKind='dogfight'|'pursuit'
interface EngagementRule {kind:EngagementKind;startRange:number}
interface OpeningAttack {attackerId:string;defenderId:string;hit:boolean;probability:CombatProbabilityRecord;impactTime:number;resolved:boolean}
interface ActiveEngagement {
  id:string;kind:EngagementKind;attacker:SimUnit;target:SimUnit;location:Point;start:number;nextExchange:number;exchanges:CombatExchange[];effects:WeaponEffect[]
  participants:SimUnit[];initialParticipants:Record<string,{strength:number;aircraft:number}>;joinedAt:Record<string,number>;exitedAt:Record<string,number>
  positionalAssessments:FighterPositionalAssessment[];openingAttack?:OpeningAttack;mergedAt?:number
  nextSide:'friendly'|'hostile';sideAttackCursor:Record<'friendly'|'hostile',number>
}
interface EngagementUpdate {active?:ActiveEngagement;roll:number;sequence?:CombatSequence;effects:WeaponEffect[];released:SimUnit[]}
export const TICK_SECONDS=.05
const point=(a:Point,b:Point,d:number):Point=>{const l=distance(a,b);return l<=d?[...b] as Point:[a[0]+(b[0]-a[0])*d/l,a[1]+(b[1]-a[1])*d/l]}
const terminal=(u:SimUnit)=>u.mode==='recovered'||u.mode==='trapped'||u.mode==='destroyed'
const AIR_ENGAGEMENT_RULES:Record<Role,Partial<Record<Role,EngagementRule>>>={
  fighter:{fighter:{kind:'dogfight',startRange:FIGHTER_MERGE_RANGE},recon:{kind:'pursuit',startRange:FIGHTER_MERGE_RANGE}},
  recon:{},
}

function engagementRuleFor(attacker:SimUnit,target:SimUnit){return AIR_ENGAGEMENT_RULES[attacker.role][target.role]}
function hasFuelForIntercept(unit:SimUnit,target:SimUnit,base:Point){return unit.traveled+distance(unit.position,target.position)+distance(target.position,base)<=MAX_FLIGHT_DISTANCE.fighter}
function selectAirTarget(unit:SimUnit,contacts:AirContact[],recovery:Point){
  if(unit.role!=='fighter')return undefined
  const current=unit.mode==='intercepting'&&unit.targetId?contacts.find(contact=>contact.target.id===unit.targetId&&!terminal(contact.target)):undefined
  if(current&&hasFuelForIntercept(unit,current.target,recovery))return current
  const squadron=unit.source as Squadron
  return nearestResponsibleContact(squadron,unit.position,contacts.filter(contact=>!terminal(contact.target)).map(contact=>({...contact,id:contact.target.id,position:contact.target.position})),contact=>hasFuelForIntercept(unit,contact.target,recovery))
}
const fighterSide=(unit:SimUnit):'friendly'|'hostile'=>unit.friendly?'friendly':'hostile'
function fighterAssessment(participant:SimUnit,opponent:SimUnit,time:number):FighterPositionalAssessment{
  const heading=(unit:SimUnit):Point=>[unit.facing[0]-unit.position[0],unit.facing[1]-unit.position[1]]
  const participantHeading=heading(participant),opponentHeading=heading(opponent)
  const evaluation=evaluateFighterPositionalAdvantage({participantPosition:participant.position,participantHeading,opponentPosition:opponent.position,opponentHeading})
  return {evaluatedAt:time,participantId:participant.id,opponentId:opponent.id,classification:evaluation.classification,participantPosition:[...participant.position] as Point,participantHeading,opponentPosition:[...opponent.position] as Point,opponentHeading,evaluation}
}

function createActiveEngagement(id:string,kind:EngagementKind,attacker:SimUnit,target:SimUnit,time:number,transition:TransitionUnit,add:AddCombatEvent){
  const rule=engagementRuleFor(attacker,target)
  if(!rule||rule.kind!==kind||terminal(attacker)||terminal(target)||distance(attacker.position,target.position)>rule.startRange)return undefined
  const location:Point=[(attacker.position[0]+target.position[0])/2,(attacker.position[1]+target.position[1])/2]
  const positionalAssessments=kind==='dogfight'?[fighterAssessment(attacker,target,time),fighterAssessment(target,attacker,time)]:[]
  if(kind==='dogfight'){
    transition(attacker,'dogfighting',time,'opening-fire',target.id,'visual');transition(target,'dogfighting',time,'opening-fire',attacker.id,'visual');add('danger','FIGHTERS COMMIT',`${attacker.callsign} and ${target.callsign} enter opening-fire range.`,location,time)
  }else{
    if(attacker.friendly&&attacker.mode!=='intercepting')return undefined
    transition(attacker,'attacking-recon',time,'recon-intercept',target.id,'visual');add(attacker.friendly?'friendly':'danger','RECON UNDER PURSUIT',`${attacker.callsign} pursues ${target.callsign}; weapons fire only while the recon flight remains in close range.`,location,time)
  }
  return {id,kind,attacker,target,location,start:time,nextExchange:time,exchanges:[],effects:[],participants:[attacker,target],initialParticipants:{[attacker.id]:{strength:attacker.strength,aircraft:attacker.aircraft},[target.id]:{strength:target.strength,aircraft:target.aircraft}},joinedAt:{[attacker.id]:time,[target.id]:time},exitedAt:{},positionalAssessments,nextSide:fighterSide(attacker),sideAttackCursor:{friendly:0,hostile:0}} satisfies ActiveEngagement
}

function joinDogfightEngagement(engagement:ActiveEngagement,joiner:SimUnit,target:SimUnit,time:number,transition:TransitionUnit,add:AddCombatEvent){
  if(engagement.kind!=='dogfight'||engagement.participants.some(participant=>participant.id===joiner.id)||!engagement.participants.some(participant=>participant.id===target.id)||fighterSide(joiner)===fighterSide(target)||joiner.role!=='fighter'||target.role!=='fighter'||joiner.mode!=='intercepting'||terminal(joiner)||terminal(target)||distance(joiner.position,target.position)>FIGHTER_MERGE_RANGE)return false
  engagement.participants.push(joiner);engagement.initialParticipants[joiner.id]={strength:joiner.strength,aircraft:joiner.aircraft};engagement.joinedAt[joiner.id]=time
  engagement.positionalAssessments.push(fighterAssessment(joiner,target,time),fighterAssessment(target,joiner,time))
  transition(joiner,'dogfighting',time,'dogfight-join',target.id,'visual')
  add(joiner.friendly?'friendly':'danger','FIGHTER JOINS DOGFIGHT',`${joiner.callsign} reaches the merge and joins the shared engagement.`,engagement.location,time)
  return true
}

function updateDogfightEngagement(engagement:ActiveEngagement,time:number,roll:number,_index:number,transition:TransitionUnit,add:AddCombatEvent):EngagementUpdate{
  if(time<engagement.nextExchange)return {active:engagement,roll,effects:[],released:[]}
  const living=(side:'friendly'|'hostile')=>engagement.participants.filter(participant=>fighterSide(participant)===side&&!terminal(participant)&&participant.strength>0)
  const destroyParticipant=(participant:SimUnit,reason:string,at=time)=>{participant.strength=0;participant.morale=0;participant.aircraft=0;engagement.exitedAt[participant.id]=at;transition(participant,'destroyed',at,reason)}
  const completeIfResolved=():EngagementUpdate|undefined=>{
    const friendlyLiving=living('friendly'),hostileLiving=living('hostile')
    if(friendlyLiving.length&&hostileLiving.length)return undefined
    const survivors=[...friendlyLiving,...hostileLiving]
    for(const survivor of survivors){engagement.exitedAt[survivor.id]=time;transition(survivor,'following-route',time,'dogfight-complete')}
    const winningSide=friendlyLiving.length?'friendly':hostileLiving.length?'hostile':undefined
    add(winningSide==='friendly'?'friendly':'danger','DOGFIGHT ENDS',winningSide?`${winningSide==='friendly'?'Friendly':'Hostile'} fighters eliminate the opposing side; ${survivors.map(unit=>unit.callsign).join(', ')} resume their missions.`:'Both sides are destroyed.',engagement.location,time)
    const finalDisposition=Object.fromEntries(engagement.participants.map(participant=>[participant.id,terminal(participant)?'destroyed':'enroute'])) as Record<string,import('./types').ExecutionStatus>
    const openingEnd=engagement.openingAttack?.impactTime??engagement.start
    const phases=engagement.mergedAt===undefined?[{kind:'opening-fire' as const,start:engagement.start,end:openingEnd},{kind:'resolved' as const,start:time,end:time}]:[{kind:'opening-fire' as const,start:engagement.start,end:openingEnd},{kind:'merged' as const,start:engagement.mergedAt,end:time},{kind:'resolved' as const,start:time,end:time}]
    const participantRecords=engagement.participants.map(participant=>({id:participant.id,side:fighterSide(participant),joinedAt:engagement.joinedAt[participant.id],exitedAt:engagement.exitedAt[participant.id]??time,initialStrength:engagement.initialParticipants[participant.id].strength,finalStrength:participant.strength,initialAircraft:engagement.initialParticipants[participant.id].aircraft,finalAircraft:participant.aircraft,finalDisposition:finalDisposition[participant.id]}))
    const engagementRecord=createFighterEngagementRecord({start:engagement.start,end:time,phases,positionalAssessments:engagement.positionalAssessments,participants:participantRecords})
    return {roll,effects:engagement.effects,released:survivors,sequence:{id:engagement.id,kind:'dogfight',participantIds:[...engagementRecord.sides.friendly,...engagementRecord.sides.hostile],location:engagement.location,start:engagement.start,end:time,exchanges:engagement.exchanges,finalDisposition,engagement:engagementRecord}}
  }
  if(!engagement.openingAttack){
    const [firstAssessment,secondAssessment]=engagement.positionalAssessments
    roll+=1
    const openingAttackerId=selectFighterOpeningAttacker({id:firstAssessment.participantId,evaluation:firstAssessment.evaluation},{id:secondAssessment.participantId,evaluation:secondAssessment.evaluation},rand(roll))
    const openingAttacker=engagement.participants.find(participant=>participant.id===openingAttackerId)!
    const openingDefender=openingAttacker.id===engagement.attacker.id?engagement.target:engagement.attacker
    const attackerAssessment=engagement.positionalAssessments.find(assessment=>assessment.participantId===openingAttacker.id)!
    const positionDelta=FIGHTER_POSITIONAL_HIT_MODIFIERS[attackerAssessment.classification]
    roll+=1
    const resolved=resolveFighterHitProbability({baseHitProbability:FIGHTER_OPENING_MISSILE_HIT_PROBABILITY,modifiers:[{source:'position',key:`${attackerAssessment.classification}-position`,delta:positionDelta}]},rand(roll))
    const impactTime=time+.62
    engagement.openingAttack={attackerId:openingAttacker.id,defenderId:openingDefender.id,hit:resolved.hit,probability:resolved.probability,impactTime,resolved:false}
    engagement.effects.push(weapon(`weapon-opening-${engagement.id}`, 'air-to-air-missile',openingAttacker.id,openingDefender.id,time,[...openingAttacker.position] as Point,[...openingDefender.position] as Point,resolved.hit,FIGHTER_OPENING_MISSILE_DAMAGE))
    engagement.nextExchange=impactTime
    add(openingAttacker.friendly?'friendly':'danger','OPENING MISSILE',`${openingAttacker.callsign} takes ${attackerAssessment.classification.toUpperCase()} initiative and fires before the merge.`,engagement.location,time)
    return {active:engagement,roll,effects:[],released:[]}
  }
  if(!engagement.openingAttack.resolved){
    const openingAttacker=engagement.participants.find(participant=>participant.id===engagement.openingAttack!.attackerId)!
    const openingDefender=engagement.participants.find(participant=>participant.id===engagement.openingAttack!.defenderId)!
    const amount=engagement.openingAttack.hit?FIGHTER_OPENING_MISSILE_DAMAGE:0
    const applied=engagement.openingAttack.hit?damage(openingDefender,amount,false):{strength:openingDefender.strength,morale:openingDefender.morale}
    engagement.exchanges.push({id:`${engagement.id}-opening`,time:engagement.openingAttack.impactTime,attackerId:openingAttacker.id,defenderId:openingDefender.id,weapon:'air-to-air-missile',damage:amount,moraleDamage:amount*.6,hit:engagement.openingAttack.hit,position:engagement.location,targetStrength:applied.strength,targetMorale:applied.morale,probability:engagement.openingAttack.probability,resolution:'probability',phase:'opening-fire'})
    engagement.openingAttack.resolved=true
    if(openingDefender.strength<=0){destroyParticipant(openingDefender,'opening-fire-loss',engagement.openingAttack.impactTime);add(openingAttacker.friendly?'friendly':'danger','OPENING-FIRE KILL',`${openingAttacker.callsign} destroys ${openingDefender.callsign} before the merge.`,engagement.location,engagement.openingAttack.impactTime);const completed=completeIfResolved();if(completed)return completed}
    engagement.mergedAt=engagement.openingAttack.impactTime;engagement.nextExchange=engagement.openingAttack.impactTime+.35;add('danger','DOGFIGHT MERGED',`${living('friendly').length} friendly and ${living('hostile').length} hostile formations enter sustained combat.`,engagement.location,engagement.openingAttack.impactTime);return {active:engagement,roll,effects:[],released:[]}
  }
  const actingSide=living(engagement.nextSide).length?engagement.nextSide:engagement.nextSide==='friendly'?'hostile':'friendly'
  const attackers=living(actingSide);const defenders=living(actingSide==='friendly'?'hostile':'friendly')
  if(!attackers.length||!defenders.length){const completed=completeIfResolved();if(completed)return completed;return {active:engagement,roll,effects:[],released:[]}}
  const attacker=attackers[engagement.sideAttackCursor[actingSide]%attackers.length];engagement.sideAttackCursor[actingSide]+=1
  const defender=[...defenders].sort((left,right)=>left.strength-right.strength||engagement.joinedAt[left.id]-engagement.joinedAt[right.id]||left.id.localeCompare(right.id))[0]
  engagement.nextSide=actingSide==='friendly'?'hostile':'friendly'
  roll+=1
  // Inverting the existing seeded value preserves the prior `rand(seed) > .31`
  // behavior while exposing the conventional `roll < probability` record.
  const numerical=evaluateFighterNumericalAdvantage(calculateFighterSidePower(attackers),calculateFighterSidePower(defenders));const resolved=resolveFighterHitProbability({baseHitProbability:FIGHTER_SUSTAINED_GUN_HIT_PROBABILITY,modifiers:[{source:'numbers',key:numerical.classification,delta:numerical.hitProbabilityDelta}]},1-rand(roll));const amount=resolved.hit?22:0
  const applied=resolved.hit?damage(defender,amount,false):{strength:defender.strength,morale:defender.morale};engagement.exchanges.push({id:`${engagement.id}-fight-${engagement.exchanges.length}`,time,attackerId:attacker.id,defenderId:defender.id,weapon:'gun',damage:amount,moraleDamage:amount*.6,hit:resolved.hit,position:engagement.location,targetStrength:applied.strength,targetMorale:applied.morale,probability:resolved.probability,numericalAssessment:numerical,resolution:'probability',phase:'merged'});engagement.nextExchange=time+.35
  if(defender.strength<=0){destroyParticipant(defender,'dogfight-loss',time);add(attacker.friendly?'friendly':'danger','FIGHTER FORMATION LOST',`${attacker.callsign} destroys ${defender.callsign}; the shared engagement continues if both sides remain.`,engagement.location,time)}
  const completed=completeIfResolved();if(completed)return completed
  return {active:engagement,roll,effects:[],released:[]}
}

function updatePursuitEngagement(engagement:ActiveEngagement,time:number,roll:number,_round:number,_index:number,transition:TransitionUnit,add:AddCombatEvent):EngagementUpdate{
  const range=distance(engagement.attacker.position,engagement.target.position);const canStrike=!terminal(engagement.target)&&engagement.attacker.mode==='attacking-recon'&&range<=FIGHTER_MERGE_RANGE
  if(canStrike&&time>=engagement.nextExchange){const kind:WeaponKind=engagement.exchanges.length%2===0?'air-to-air-missile':'gun';const hit=rand(roll++)<.68;const amount=hit?(kind==='gun'?Math.round(12+rand(roll++)*7):Math.round(26+rand(roll++)*12)):0;const applied=hit?damage(engagement.target,amount):{strength:engagement.target.strength,morale:engagement.target.morale};const exchangeIndex=engagement.exchanges.length;engagement.exchanges.push({id:`${engagement.id}-exchange-${exchangeIndex}`,time,attackerId:engagement.attacker.id,defenderId:engagement.target.id,weapon:kind,damage:amount,moraleDamage:hit?8:0,hit,position:[...engagement.target.position] as Point,targetStrength:applied.strength,targetMorale:applied.morale});engagement.effects.push(weapon(`weapon-${engagement.id}-${exchangeIndex}`,kind,engagement.attacker.id,engagement.target.id,time-.16,[...engagement.attacker.position] as Point,[...engagement.target.position] as Point,hit,amount));engagement.nextExchange=time+.5
    if(engagement.target.aircraft<=0){transition(engagement.target,'destroyed',time,'fighter-pursuit');add('friendly','RECON DESTROYED',`${engagement.attacker.callsign} destroys ${engagement.target.callsign} in pursuit.`,engagement.target.position,time)}
  }
  const escaped=!terminal(engagement.target)&&range>effectiveSensorRange(engagement.attacker.source as Squadron);const complete=terminal(engagement.target)||engagement.exchanges.length>=4||escaped||engagement.attacker.mode!=='attacking-recon'
  if(!complete)return {active:engagement,roll,effects:[],released:[]}
  if(engagement.attacker.mode==='attacking-recon'){
    // Pursuit is only a temporary diversion. Resume the assigned CAP/patrol
    // route after either outcome; the normal movement fuel-reserve check will
    // transition the fighter to recovery if the diversion used its remaining
    // range.
    transition(engagement.attacker,'following-route',time,engagement.target.mode==='destroyed'?'recon-destroyed':'recon-escaped')
  }
  if(engagement.target.mode!=='destroyed')add('warning','RECON ESCAPES PURSUIT',`${engagement.target.callsign} opens the distance and ${engagement.target.mode==='recovered'?'completes recovery':'continues its current route'}.`,engagement.target.position,time)
  return {roll,effects:engagement.effects,released:[engagement.attacker,engagement.target].filter(unit=>!terminal(unit)),sequence:{id:engagement.id,kind:'pursuit',participantIds:[engagement.attacker.id,engagement.target.id],location:engagement.location,start:engagement.start,end:time,exchanges:engagement.exchanges,finalDisposition:{[engagement.attacker.id]:engagement.attacker.mode==='destroyed'?'destroyed':'enroute',[engagement.target.id]:engagement.target.mode==='destroyed'?'destroyed':engagement.target.mode==='recovering'?'rtb':'enroute'}}}
}

function updateAirEngagement(engagement:ActiveEngagement,time:number,roll:number,round:number,index:number,transition:TransitionUnit,add:AddCombatEvent){
  return engagement.kind==='dogfight'?updateDogfightEngagement(engagement,time,roll,index,transition,add):updatePursuitEngagement(engagement,time,roll,round,index,transition,add)
}

function* simulateRoundTicks(state:MatchState):Generator<RoundResult,RoundResult,SimulationCommand[]>{
  const normalizedPlayerAssets=normalizeFormationBasing(state.squadrons,state.playerAssets);const simulationState={...state,playerAssets:normalizedPlayerAssets};const base=playerBase(simulationState); const enemyBase=enemyBaseFor(state.world); const assets=structuredClone(state.enemyAssets); let playerAssets=structuredClone(normalizedPlayerAssets); const squadrons=structuredClone(state.squadrons); const flights=enemyFlights(simulationState);
  const events:CombatEvent[]=[]; const sequences:CombatSequence[]=[]; const effects:WeaponEffect[]=[]; const observations:ContactObservation[]=[]; const receipts:RadarTrackReceipt[]=[]; const plans:InterceptPlan[]=[]; const intelReports:IntelReport[]=[]; const intervals:ContactInterval[]=[]; const behavior:BehaviorInterval[]=[]; const commands:SimulationCommand[]=[];const threatAlerts:ThreatAlert[]=[];const alertedThreats=new Set<string>(); const add=(tone:CombatEvent['tone'],title:string,detail:string,position?:Point,time=0)=>events.push({id:`${state.round}-${events.length}`,tone,title,detail,position,time});
  const make=(s:Squadron|EnemyFlight,friendly:boolean):SimUnit=>{
    if(!friendly)return {id:s.id,callsign:s.callsign,role:s.role,friendly:false,position:[...s.route[0]] as Point,facing:[...s.route[1]??s.route[0]] as Point,route:s.route,waypoint:1,mode:(s.aircraft??0)>0?'following-route':'destroyed',strength:strengthOf(s),morale:s.morale??70,aircraft:s.aircraft,maxAircraft:(s as EnemyFlight).initialAircraft,traveled:0,frames:[],observed:new Set,boundaryObservations:[],source:s}
    const squadron=s as Squadron;const launch=formationField(playerAssets,squadron.id)??playerAssets.find(asset=>asset.kind==='base')!;const intended=playerAssets.find(asset=>asset.id===(squadron.plannedRecoveryFieldId??launch.id))??launch;const route:Point[]=[[...launch.position],...squadron.route.slice(1)];if(distance(route.at(-1)!,intended.position)>.03)route.push([...intended.position]);const trapped=launch.kind==='fob'&&launch.operational===false
    return {id:s.id,callsign:s.callsign,role:s.role,friendly:true,position:[...launch.position],facing:[...route[1]??launch.position],route,waypoint:1,mode:s.aircraft<=0?'destroyed':trapped?'trapped':'following-route',strength:strengthOf(s),morale:s.morale??70,aircraft:s.aircraft,maxAircraft:squadron.maxAircraft,traveled:0,frames:[],observed:new Set,boundaryObservations:[],source:s,launchFieldId:launch.id,plannedFieldId:squadron.plannedRecoveryFieldId??launch.id,recoveryFieldId:intended.id,...(trapped?{trapped:true}: {})}
  }
  const units=[...squadrons.map(s=>make(s,true)),...flights.map(s=>make(s,false))]; const byId=new Map(units.map(u=>[u.id,u])); const openContacts=new Map<string,ContactInterval>(); const openReceipts=new Map<string,RadarTrackReceipt>(); const openBehavior=new Map<string,BehaviorInterval>(); const fired=new Set<string>(); let roll=state.seed+state.round*31; let activeEngagements:ActiveEngagement[]=[];let engagementSerial=0
  const fieldClaims=new Map(playerAssets.filter(asset=>asset.kind==='fob').map(asset=>[asset.id,new Set<string>()]));for(const unit of units.filter(unit=>unit.friendly&&unit.aircraft>0)){const fieldId=unit.trapped?unit.launchFieldId:unit.recoveryFieldId;if(fieldId)fieldClaims.get(fieldId)?.add(unit.id)}
  const releaseClaim=(unit:SimUnit)=>{for(const ids of fieldClaims.values())ids.delete(unit.id)}
  const claim=(unit:SimUnit,fieldId:string)=>{releaseClaim(unit);fieldClaims.get(fieldId)?.add(unit.id)}
  const transition=(u:SimUnit,mode:FlightMode,time:number,reason:string,targetId?:string,source?:'radar'|'visual')=>{if(u.mode===mode&&u.targetId===targetId)return;const old=openBehavior.get(u.id);if(old)old.end=time;u.mode=mode;u.targetId=targetId;const item:BehaviorInterval={id:`behavior-${behavior.length}`,unitId:u.id,mode,start:time,end:time,targetId,source,reason};behavior.push(item);openBehavior.set(u.id,item)}
  const record=(time:number)=>units.forEach(u=>u.frames.push({time,position:[...u.position] as Point,facing:[...u.facing] as Point,mode:u.mode,strength:u.strength,morale:u.morale,aircraft:u.aircraft,traveledDistance:u.traveled}))
  const contact=(observerId:string,targetId:string,source:'radar'|'visual',position:Point,active:boolean,time:number)=>{const key=`${observerId}:${targetId}:${source}`;const old=openContacts.get(key);if(active&&!old){const x={id:`contact-${intervals.length}`,observerId,targetId,source,start:time,end:time,position:[...position] as Point};intervals.push(x);openContacts.set(key,x)}else if(active&&old)old.end=time;else if(!active&&old){old.end=time;openContacts.delete(key)}}
  add('info','SORTIES AIRBORNE',`${units.filter(u=>u.friendly&&!u.trapped).reduce((n,u)=>n+u.aircraft,0)} aircraft committed.`,undefined,.8)
  for(const u of units)transition(u,u.mode,0,'round-start')
  record(0)
  const liveResult=(duration:number):RoundResult=>({round:state.round,duration:Math.max(TICK_SECONDS,duration),tickSeconds:TICK_SECONDS,unitTracks:units.map(u=>({unitId:u.id,frames:u.frames})),contactIntervals:intervals,behaviorIntervals:behavior.map(item=>openBehavior.get(item.unitId)===item?{...item,end:duration}:item),events,squadrons,assets,enemyLosses:0,friendlyLosses:0,friendlyAttrition:[],enemyAttrition:[],friendlyFormationsDestroyed:0,enemyFormationsDestroyed:0,intelGained:[],baseDamage:0,enemyBaseDamage:0,logisticsIncome:{base:0,intel:0,enemyAircraft:0,total:0},command:state.command,executionRoutes:Object.fromEntries(units.map(u=>[u.id,u.frames.map(f=>f.position)])),enemyFlights:flights.map(f=>({...f,detectionWindows:intervals.filter(i=>i.targetId===f.id).map(i=>({start:i.start/Math.max(TICK_SECONDS,duration),end:i.end/Math.max(TICK_SECONDS,duration),source:i.source,observer:i.observerId}))})),defenseCues:[],defensiveAwareness:0,lessons:[],playerAssets,reinforcementCalls:[],roundScore:0,baseExposure:state.baseExposure,baseExposureDelta:0,combatSequences:sequences,weaponEffects:[...effects,...activeEngagements.flatMap(engagement=>engagement.effects)],contactObservations:observations,radarTrackReceipts:receipts,interceptPlans:plans,intelReports:[],mappedAreas:[],discoveredBoundaries:[],recoveryOutcomes:[],simulationCommands:commands,threatAlerts})
  let debugFieldDisabled=false
  let pendingCommands:SimulationCommand[]=yield liveResult(0)
  for(let time=TICK_SECONDS;time<=60+EXECUTION_SECONDS+1e-6;time+=TICK_SECONDS){
    for(const command of pendingCommands){if(command.type!=='rtb'||command.issuedAtTick!==Math.round(time/TICK_SECONDS)||commands.some(existing=>existing.id===command.id))continue;const unit=byId.get(command.unitId);if(!unit?.friendly||unit.role!=='recon'||terminal(unit)||unit.recoveryCommanded)continue;commands.push(command);unit.recoveryCommanded=true;transition(unit,'recovering',time,'player-rtb');add('friendly','RTB ORDERED',`${unit.callsign} turns for recovery on player command.`,unit.position,time)}
    const debugDisableTime=state.debugScenario==='fob-stranded'?14:4
    if(!debugFieldDisabled&&time>=debugDisableTime&&(state.debugScenario==='fob-divert'||state.debugScenario==='fob-stranded')){const fob=playerAssets.find(asset=>asset.id==='p-fob-1');if(fob){playerAssets=setAirfieldOperational(playerAssets,fob.id,false);debugFieldDisabled=true;add('danger','FORWARD BASE UNUSABLE',`${fob.name??'Forward base'} can no longer accept aircraft.`,fob.position,time)}}
    // 1-2: fixed speed motion and fuel reserve.
    for(const u of units){if(terminal(u)||u.mode==='dogfighting')continue;let recoveryField=u.friendly?playerAssets.find(asset=>asset.id===u.recoveryFieldId):undefined
      if(u.friendly&&u.mode!=='stranded'&&recoveryField&&!isOperationalAirfield(recoveryField)){releaseClaim(u);const alternate=nearestReachableAlternate({...simulationState,playerAssets,squadrons},u.id,u.position,MAX_FLIGHT_DISTANCE[u.role]-u.traveled,recoveryField.id,fieldClaims);if(alternate){u.recoveryFieldId=alternate.id;u.diverted=true;claim(u,alternate.id);recoveryField=alternate;transition(u,'recovering',time,'recovery-field-unusable');add('warning','RECOVERY DIVERSION',`${u.callsign} diverts to ${alternate.name??(alternate.kind==='base'?'HOME BASE':'FORWARD BASE')}.`,u.position,time)}else{u.strandedCenter=[u.position[0]-.35,u.position[1]];u.strandedAngle=0;transition(u,'stranded',time,'no-reachable-recovery');add('danger','NO RECOVERY FIELD',`${u.callsign} has no reachable operational recovery field and will be lost at fuel exhaustion.`,u.position,time)}}
      const home=u.friendly?(recoveryField?.position??base):enemyBase
      if(u.mode==='stranded'){const step=MAX_FLIGHT_DISTANCE[u.role]/EXECUTION_SECONDS*TICK_SECONDS;const remaining=MAX_FLIGHT_DISTANCE[u.role]-u.traveled;if(remaining<=step+.001){u.traveled=MAX_FLIGHT_DISTANCE[u.role];u.aircraft=0;u.strength=0;releaseClaim(u);transition(u,'destroyed',time,'fuel-exhaustion');add('danger','FORMATION LOST',`${u.callsign} exhausts its fuel without a usable recovery field.`,u.position,time);continue}const radius=.35;u.strandedAngle=(u.strandedAngle??0)+step/radius;const center=u.strandedCenter??u.position;const next:[number,number]=[center[0]+Math.cos(u.strandedAngle)*radius,center[1]+Math.sin(u.strandedAngle)*radius];u.facing=[...next];u.position=next;u.traveled+=step;continue}
      let destination:Point=u.position
      if(u.mode==='following-route')destination=u.route[u.waypoint] as never; else if(u.mode==='recovering')destination=home as never; else if(u.mode==='intercepting'){const target=u.targetId?byId.get(u.targetId):undefined;destination=(target?.position??home) as never}
      else if(u.mode==='attacking-recon'){const target=u.targetId?byId.get(u.targetId):undefined;destination=(target?.position??home) as never}
      if(!destination){transition(u,'recovering',time,'route-complete');continue} const step=MAX_FLIGHT_DISTANCE[u.role]/EXECUTION_SECONDS*TICK_SECONDS; const next=point(u.position,destination,step); const moved=distance(u.position,next)
      if(u.friendly&&u.mode!=='recovering'&&u.traveled+moved+distance(next,home)>MAX_FLIGHT_DISTANCE[u.role]+.001){transition(u,'recovering',time,'fuel-reserve');continue}
      const edgeHit=intersectMovementWithWorld(u.position,next,state.world.bounds)
      if(edgeHit){const edgeDistance=distance(u.position,edgeHit.point);u.facing=destination;u.position=edgeHit.point;u.traveled+=edgeDistance;if(u.friendly&&u.role==='recon'){u.boundaryObservations.push(...boundarySegmentsObservedAt(edgeHit.point,MAPPED_AREA_RADIUS,state.world.bounds));add('warning','WORLD EDGE OBSERVED',`${u.callsign} reaches an unknown world boundary and turns for home.`,edgeHit.point,time)}transition(u,'recovering',time,'world-edge');continue}
      u.facing=destination;u.position=next;u.traveled+=moved
      if(distance(u.position,destination)<.03){u.position=[...destination] as Point;if(u.mode==='following-route'){u.waypoint++;if(u.waypoint>=u.route.length)transition(u,'recovering',time,'route-complete')}else if(u.mode==='recovering')transition(u,'recovered',time,'home-reached')}
    }
    // 3: contacts and actual communications. A radar receipt is a
    // friendly-network product, not a generic consequence of being inside any
    // radar's coverage. Hostile radar can threaten a friendly flight, but it
    // cannot publish its tracks into the player's network.
    const current=new Map<string,AirContact[]>(); const radar=playerAssets.find(a=>a.kind==='radar'&&a.health>0)
    for(const friendly of units.filter(u=>u.friendly&&!terminal(u))){const seen:AirContact[]=[];for(const enemy of units.filter(u=>!u.friendly&&!terminal(u))){const visual=distance(friendly.position,enemy.position)<=effectiveSensorRange(friendly.source as Squadron);contact(friendly.id,enemy.id,'visual',enemy.position,visual,time);if(visual)seen.push({target:enemy,source:'visual'}); // `radar` is selected only from playerAssets; enemy radar never enters this link.
      const linked=!!radar&&distance(radar.position,enemy.position)<=RADAR_RANGE&&distance(friendly.position,radar.position)<=RADAR_COMMUNICATION_RANGE;contact(friendly.id,enemy.id,'radar',enemy.position,linked,time);const key=`${friendly.id}:${enemy.id}`;const receipt=openReceipts.get(key);if(linked){if(receipt)receipt.end=time;else{const next={id:`receipt-${receipts.length}`,radarId:radar!.id,receiverId:friendly.id,targetId:enemy.id,start:time,end:time};receipts.push(next);openReceipts.set(key,next)}seen.push({target:enemy,source:'radar'})}else if(receipt)openReceipts.delete(key)}current.set(friendly.id,seen)}
    // 4-5: shared reaction priority, pursuit, and direct combat. A formation
    // may belong to only one engagement; independent pairs can fight at once.
    const engagedUnitIds=()=>new Set(activeEngagements.flatMap(engagement=>engagement.participants.map(participant=>participant.id)))
    const evaluateReaction=(u:SimUnit)=>{if(terminal(u)||engagedUnitIds().has(u.id)||u.mode==='stranded')return;const seen:AirContact[]=u.friendly?(current.get(u.id)??[]):[];const recovery=playerAssets.find(asset=>asset.id===u.recoveryFieldId)?.position??base;const choice=u.friendly?selectAirTarget(u,seen,recovery):undefined
      const hostileVisual=seen.find(x=>x.source==='visual'&&x.target.role==='fighter')
      if(u.role==='recon'&&hostileVisual){const key=`fighter:${u.id}:${hostileVisual.target.id}`;if(!alertedThreats.has(key)){alertedThreats.add(key);threatAlerts.push({id:`threat-${threatAlerts.length}`,unitId:u.id,time,kind:'fighter-contact',sourceId:hostileVisual.target.id});add('warning','RECON THREAT',`${u.callsign} has direct fighter contact and continues searching until ordered home.`,u.position,time)}}
      const decision=decideReaction({destroyed:u.mode==='destroyed',inDirectCombat:false,recoveryCommanded:!!u.recoveryCommanded,recoveryRequired:u.mode==='recovering',actionableTargetId:choice?.target.id,missionAvailable:u.waypoint<u.route.length})
      if(decision.state==='recovering'){if(u.mode!=='recovering')transition(u,'recovering',time,decision.reason);return}
      if(decision.state==='intercept'&&choice){if(u.mode!=='intercepting'||u.targetId!==choice.target.id){transition(u,'intercepting',time,choice.source==='visual'?'visual-contact-in-responsibility':'radar-contact-in-responsibility',choice.target.id,choice.source);plans.push({squadronId:u.id,targetId:choice.target.id,start:time,end:time,source:choice.source,outcome:'merge'});add('friendly','FIGHTER INTERCEPT',`${u.callsign} diverts on a ${choice.source.toUpperCase()} contact inside its ${((u.source as Squadron).mission==='defensive-cap'?'CAP area':'patrol corridor')}.`,u.position,time)}return}
      if(decision.state==='mission'&&u.mode!=='following-route'){const lost=u.mode==='intercepting';transition(u,'following-route',time,decision.reason);if(lost)add('warning','FIGHTER TRACK LOST',`${u.callsign} loses the current contact and resumes its mission.`,u.position,time)}
    }
    for(const u of units.filter(u=>!terminal(u)))evaluateReaction(u)

    // A fighter already vectoring to a participant may join that dogfight.
    for(const engagement of activeEngagements.filter(item=>item.kind==='dogfight'))for(const joiner of units.filter(u=>u.role==='fighter'&&u.mode==='intercepting'&&!engagedUnitIds().has(u.id))){const target=joiner.targetId?byId.get(joiner.targetId):undefined;if(target)joinDogfightEngagement(engagement,joiner,target,time,transition,add)}

    // Direct fighter contact outranks pursuit. Close opposing fighters create a
    // dogfight even when one was chasing recon; that pursuit is ended and is
    // never silently resumed from historical state.
    const fighterPairs: Array<[SimUnit,SimUnit]>=[];const livingFighters=units.filter(unit=>unit.role==='fighter'&&!terminal(unit))
    for(let left=0;left<livingFighters.length;left++)for(let right=left+1;right<livingFighters.length;right++){const a=livingFighters[left],b=livingFighters[right];if(a.friendly!==b.friendly&&distance(a.position,b.position)<=FIGHTER_MERGE_RANGE)fighterPairs.push([a,b])}
    for(const [a,b] of fighterPairs){if(activeEngagements.some(engagement=>engagement.kind==='dogfight'&&engagement.participants.some(participant=>participant.id===a.id||participant.id===b.id)))continue
      for(const fighter of [a,b]){const pursuit=activeEngagements.find(engagement=>engagement.kind==='pursuit'&&engagement.attacker.id===fighter.id);if(!pursuit)continue;activeEngagements=activeEngagements.filter(item=>item!==pursuit);if(!terminal(pursuit.attacker))transition(pursuit.attacker,'following-route',time,'pursuit-interrupted-by-combat');sequences.push({id:pursuit.id,kind:'pursuit',participantIds:[pursuit.attacker.id,pursuit.target.id],location:pursuit.location,start:pursuit.start,end:time,exchanges:pursuit.exchanges,finalDisposition:{[pursuit.attacker.id]:terminal(pursuit.attacker)?'destroyed':'enroute',[pursuit.target.id]:terminal(pursuit.target)?'destroyed':pursuit.target.mode==='recovering'?'rtb':'enroute'}});effects.push(...pursuit.effects);add('warning','PURSUIT INTERRUPTED',`${fighter.callsign} breaks from ${pursuit.target.callsign} to answer direct fighter contact.`,fighter.position,time)}
      if(engagedUnitIds().has(a.id)||engagedUnitIds().has(b.id))continue;const started=createActiveEngagement(`dogfight-${state.round}-${engagementSerial++}`,'dogfight',a,b,time,transition,add);if(started)activeEngagements.push(started)
    }

    // Voluntary friendly pursuit and unavoidable hostile visual pursuit use
    // the same bounded engagement, but remain independently controllable.
    for(const attacker of units.filter(u=>u.role==='fighter'&&!terminal(u))){if(engagedUnitIds().has(attacker.id))continue;let target:SimUnit|undefined
      if(attacker.friendly&&attacker.mode==='intercepting')target=attacker.targetId?byId.get(attacker.targetId):undefined
      else if(!attacker.friendly)target=units.filter(unit=>unit.friendly&&unit.role==='recon'&&!terminal(unit)&&!engagedUnitIds().has(unit.id)&&distance(attacker.position,unit.position)<=FIGHTER_MERGE_RANGE).sort((a,b)=>distance(attacker.position,a.position)-distance(attacker.position,b.position)||a.id.localeCompare(b.id))[0]
      if(!target||target.role!=='recon'||engagedUnitIds().has(target.id))continue;const started=createActiveEngagement(`pursuit-${state.round}-${engagementSerial++}`,'pursuit',attacker,target,time,transition,add);if(started)activeEngagements.push(started)
    }
    // 6-7: tick-level defenses, impacts (instant deterministic impact at range entry).
    for(const asset of [...assets,...playerAssets].filter((a):a is Asset&{kind:'sam'|'aaa'}=>a.kind==='sam'||a.kind==='aaa'))for(const target of units.filter(u=>!terminal(u)&&u.friendly===assets.includes(asset))){const range=asset.kind==='sam'?3.2:1.9;const key=`${asset.id}:${target.id}`;if(!fired.has(key)&&distance(asset.position,target.position)<=range){fired.add(key);if(target.friendly&&target.role==='recon'){threatAlerts.push({id:`threat-${threatAlerts.length}`,unitId:target.id,time,kind:asset.kind==='sam'?'sam-launch':'aaa-launch',sourceId:asset.id});add('warning','RECON THREAT',`${target.callsign} is targeted by ${asset.kind.toUpperCase()} and continues searching until ordered home.`,target.position,time)}roll+=1;const hit=rand(roll)>(asset.kind==='sam'?.36:.48);const damage=asset.kind==='sam'?38:13;effects.push({id:`weapon-${effects.length}`,kind:asset.kind,sourceId:asset.id,targetId:target.id,start:time,end:time+.28,from:asset.position,to:[...target.position] as Point,hit,damage});const ex:CombatExchange={id:`defense-${effects.length}`,time:time+.28,attackerId:asset.id,defenderId:target.id,weapon:asset.kind,damage,moraleDamage:damage*.45,hit,position:[...target.position] as Point,targetStrength:target.strength,targetMorale:target.morale};if(hit){target.strength=Math.max(0,target.strength-damage);target.morale=Math.max(0,target.morale-damage*.45);if(target.strength<=0){target.aircraft=0;transition(target,'destroyed',time+.28,'defense-hit');add(target.friendly?'danger':'friendly',target.friendly?'AIRCRAFT LOST':'ENEMY AIRCRAFT LOST',`${target.callsign} is destroyed by ${asset.kind.toUpperCase()}.`,target.position,time+.28)}}sequences.push({id:`defense-${sequences.length}`,kind:'defense',participantIds:[asset.id,target.id],location:[...target.position] as Point,start:time,end:time+.28,exchanges:[ex],finalDisposition:{[target.id]:target.mode==='destroyed'?'destroyed':'enroute'}})}}
    // Every damage source updates strength first; this single conversion keeps the aircraft-pip model authoritative.
    for(const unit of units)if(unit.mode!=='dogfighting')unit.aircraft=aircraftFor(unit.strength,unit.maxAircraft)
    const nextEngagements:ActiveEngagement[]=[];const released:SimUnit[]=[]
    for(const engagement of activeEngagements.sort((a,b)=>a.id.localeCompare(b.id))){const update=updateAirEngagement(engagement,time,roll,state.round,sequences.length,transition,add);roll=update.roll;if(update.active)nextEngagements.push(update.active);if(update.sequence)sequences.push(update.sequence);effects.push(...update.effects);released.push(...update.released)}
    activeEngagements=nextEngagements
    // Reassess released aircraft from current contacts and explicit commands;
    // no pre-combat target or pursuit intent survives this point.
    for(const unit of released.sort((a,b)=>a.id.localeCompare(b.id)))evaluateReaction(unit)
    for(const unit of units.filter(unit=>unit.friendly&&unit.mode==='destroyed'))releaseClaim(unit)
    for(const recon of units.filter(u=>u.friendly&&u.role==='recon'&&!terminal(u)))for(const asset of assets)if(distance(recon.position,asset.position)<=3.8)recon.observed.add(asset.id)
    record(time)
    if(time>=22&&units.every(terminal)&&activeEngagements.length===0)break
    if(time>=60&&!units.some(unit=>unit.friendly&&unit.mode==='stranded'))break
    pendingCommands=yield liveResult(time)
  }
  const duration=Math.min(60+EXECUTION_SECONDS,units.reduce((m,u)=>Math.max(m,u.frames.at(-1)?.time??0),22));for(const x of openContacts.values())x.end=duration;for(const x of openBehavior.values())x.end=duration
  for(const receipt of openReceipts.values())receipt.end=duration
  for(const flight of flights){const cs=intervals.filter(i=>i.targetId===flight.id);flight.detectionWindows=cs.map(i=>({start:i.start/duration,end:i.end/duration,source:i.source,observer:i.observerId}));flight.identityLearnedAt=cs.find(i=>i.source==='visual')?.start}
  const recoveredRecon=units.filter(u=>u.friendly&&u.role==='recon'&&u.mode==='recovered')
  const discoveredBoundaries=mergeBoundarySegments([],recoveredRecon.flatMap(u=>u.boundaryObservations))
  const existingBoundaries=mergeBoundarySegments([],state.discoveredBoundaries??[]),combinedBoundaries=mergeBoundarySegments(existingBoundaries,discoveredBoundaries)
  if(JSON.stringify(combinedBoundaries)!==JSON.stringify(existingBoundaries))add('friendly','WORLD EDGE DISCOVERED','Recovered reconnaissance confirms a section of the world boundary.',undefined,duration)
  const recoveryOutcomes:FormationRecoveryOutcome[]=units.filter(u=>u.friendly).map(u=>({formationId:u.id,launchFieldId:u.launchFieldId??'p-base',plannedFieldId:u.plannedFieldId??u.launchFieldId??'p-base',actualFieldId:u.trapped?u.launchFieldId:u.mode==='recovered'?u.recoveryFieldId:undefined,outcome:u.trapped?'trapped':u.mode==='recovered'?(u.diverted?'diverted':'recovered'):u.strandedCenter?'lost':'destroyed',reason:u.trapped?'launch-field-unusable':u.mode==='recovered'?(u.diverted?'recovery-field-diversion':'planned-recovery'):u.strandedCenter?'fuel-exhaustion':'combat-loss'}))
  for(const u of units.filter(u=>u.friendly)){const s=squadrons.find(x=>x.id===u.id)!;Object.assign(s,{aircraft:u.aircraft,strength:u.strength,morale:u.morale,plannedRecoveryFieldId:undefined,status:u.trapped?'trapped':u.mode==='destroyed'?'destroyed':'rtb',readiness:u.trapped?s.readiness:Math.max(25,s.readiness-(u.role==='fighter'?12:7)),ammo:u.trapped?s.ammo:Math.max(0,s.ammo-(u.role==='fighter'?28:8))});if(u.role==='recon')for(const id of u.observed){const asset=assets.find(a=>a.id===id)!;const recovered=u.mode==='recovered';const newlyDiscovered=asset.intel==='unknown';if(newlyDiscovered)intelReports.push({id:`intel-${id}`,observerId:u.id,assetId:id,confidence:90,recovered,detail:`${u.callsign} ${recovered?'recovered':'did not recover'} observation of ${asset.kind}.`});if(recovered){asset.confidence=Math.max(90,asset.confidence);asset.intel=levelFor(asset.confidence);asset.hidden=false;if(newlyDiscovered)add('friendly','INTEL RECOVERED',`${u.callsign} returns with ${asset.kind.toUpperCase()} coordinates.`,asset.position,duration)}else if(newlyDiscovered)add('danger','INTEL LOST',`${u.callsign}'s observation did not return.`,asset.position,duration)}}
  playerAssets=applyRecoveryOutcomesToBasing(playerAssets,recoveryOutcomes,squadrons)
  for(const f of flights){const u=byId.get(f.id)!;Object.assign(f,{aircraft:u.aircraft,strength:u.strength,morale:u.morale,status:u.mode==='destroyed'?'destroyed':'rtb'})}
  const unresolved=units.some(unit=>!terminal(unit));add('friendly',unresolved?'ROUND TIME CAP':'RECOVERY COMPLETE',unresolved?'Airborne formations retain an unresolved recovery disposition.':'Surviving formations completed recovery.',base,duration);events.sort((a,b)=>a.time-b.time)
  const executionRoutes=Object.fromEntries(units.map(u=>[u.id,u.frames.map(f=>f.position)]));const mappedAreas=recoveredRecon.flatMap(u=>sampleRoute(executionRoutes[u.id])).filter(point=>point[0]>=state.world.bounds.minX&&point[0]<=state.world.bounds.maxX&&point[1]>=state.world.bounds.minZ&&point[1]<=state.world.bounds.maxZ);const confirmedEnemyIds=new Set(sequences.flatMap(sequence=>sequence.exchanges.filter(exchange=>exchange.hit&&exchange.damage>0&&flights.some(flight=>flight.id===exchange.defenderId)).map(exchange=>exchange.defenderId)));const friendlyAttrition=deriveFormationAttrition(state.squadrons,squadrons);const enemyAttrition=deriveFormationAttrition(flights.map(flight=>({...flight,aircraft:flight.initialAircraft})),flights,confirmedEnemyIds);const friendlyLosses=friendlyAttrition.reduce((total,item)=>total+item.aircraftLost,0);const enemyLosses=enemyAttrition.filter(item=>item.confirmed).reduce((total,item)=>total+item.aircraftLost,0);const logisticsIncome=deriveLogisticsIncome(state,{enemyLosses,intelReports});const result:RoundResult={round:state.round,duration,tickSeconds:TICK_SECONDS,unitTracks:units.map(u=>({unitId:u.id,frames:u.frames})),contactIntervals:intervals,behaviorIntervals:behavior,events,squadrons,assets,enemyLosses,friendlyLosses,friendlyAttrition,enemyAttrition,friendlyFormationsDestroyed:friendlyAttrition.filter(item=>item.destroyed).length,enemyFormationsDestroyed:enemyAttrition.filter(item=>item.destroyed&&item.confirmed).length,intelGained:intelReports.filter(x=>x.recovered).map(x=>x.detail),baseDamage:0,enemyBaseDamage:0,logisticsIncome,command:Math.min(3,state.command+1),executionRoutes,enemyFlights:flights,defenseCues:[],defensiveAwareness:0,lessons:events.filter(e=>['DOGFIGHT ENDS','FIGHTER TRACK LOST','INTEL RECOVERED','INTEL LOST','WORLD EDGE DISCOVERED','RECOVERY DIVERSION','FORMATION LOST','RTB ORDERED'].includes(e.title)).slice(0,4).map(e=>({title:e.title,detail:e.detail,tone:e.tone==='danger'?'danger':e.tone==='warning'?'warning':'friendly'})),playerAssets,reinforcementCalls:[],roundScore:0,baseExposure:state.baseExposure,baseExposureDelta:0,combatSequences:sequences,weaponEffects:effects,contactObservations:observations,radarTrackReceipts:receipts,interceptPlans:plans,intelReports,mappedAreas,discoveredBoundaries,recoveryOutcomes,simulationCommands:commands,threatAlerts};result.roundScore=battleScoreAt(result,Infinity);return result
}

export interface RoundSimulationController {result:RoundResult;complete:boolean;advance:(commands?:SimulationCommand[])=>RoundResult;nextTick:()=>number}
export function createRoundSimulation(state:MatchState):RoundSimulationController{
  const iterator=simulateRoundTicks(state);let cursor=iterator.next(),tick=0;const controller:RoundSimulationController={result:cursor.value,complete:cursor.done??false,advance:(next=[])=>{if(!controller.complete){cursor=iterator.next(next);tick+=1;controller.result=cursor.value;controller.complete=cursor.done??false}return controller.result},nextTick:()=>tick+1};return controller
}
export function resolveRound(state:MatchState,commands:SimulationCommand[]=[]):RoundResult{
  const controller=createRoundSimulation(state);while(!controller.complete){const tick=controller.nextTick();controller.advance(commands.filter(command=>command.issuedAtTick===tick))}return controller.result
}

export function applyRound(state:MatchState,result:RoundResult):MatchState{const applied={...state,phase:'debrief' as const,squadrons:result.squadrons,enemyAssets:result.assets,playerAssets:result.playerAssets,lastResult:result,command:result.command,campaignScore:state.campaignScore+result.roundScore,seed:state.seed+97,mappedAreas:mergeMappedAreas(state.mappedAreas??[],result.mappedAreas),discoveredBoundaries:mergeBoundarySegments(state.discoveredBoundaries??[],result.discoveredBoundaries??[])};return settleLogisticsIncome(applied,result)}
export function callReinforcement(result:RoundResult,type:ReinforcementType,time:number,base:Point):RoundResult{if(result.reinforcementCalls.some(call=>call.type===type))return result;const next=structuredClone(result);const option=REINFORCEMENT_OPTIONS[type];const target=next.squadrons.find(s=>s.aircraft<s.maxAircraft);if(type==='replacement-flight'&&!target)return result;if(target&&type==='replacement-flight')target.aircraft=Math.min(target.maxAircraft,target.aircraft+1);const call:ReinforcementCall={id:`reserve-${next.reinforcementCalls.length}`,type,time:Math.min(19,time+.5),scoreCost:option.scoreCost,title:type==='alert-cap'?'ALERT FIGHTERS ARRIVE':'REPLACEMENT FLIGHT INBOUND',detail:type==='alert-cap'?'A reserve fighter pair is ready for the next contact.':`One replacement aircraft ferries into ${target!.callsign}.`,route:[base,[-4,5],base],targetSquadronId:target?.id};next.reinforcementCalls.push(call);next.events.push({id:call.id,time:call.time,tone:'friendly',title:call.title,detail:call.detail,position:base});next.events.sort((a,b)=>a.time-b.time);return next}
export function serviceSquadronCost(sq:Squadron){return sq.damaged>0?2:sq.aircraft<sq.maxAircraft?4:0}
export function repairSquadron(state:MatchState,id:string):MatchState{const target=state.squadrons.find(s=>s.id===id);const cost=target?serviceSquadronCost(target):0;if(!target||cost===0||state.logistics<cost)return state;return {...state,logistics:state.logistics-cost,squadrons:state.squadrons.map(s=>s.id!==id?s:s.damaged>0?{...s,damaged:s.damaged-1,readiness:Math.min(100,s.readiness+14)}:{...s,aircraft:Math.min(s.maxAircraft,s.aircraft+1),strength:Math.min(100,strengthOf(s)+25)})}}
export function rearmSquadron(state:MatchState,id:string):MatchState{return state.logistics<1?state:{...state,logistics:state.logistics-1,squadrons:state.squadrons.map(s=>s.id===id?{...s,ammo:100}:s)}}
export function restoreReadiness(state:MatchState,id:string):MatchState{return state.logistics<1?state:{...state,logistics:state.logistics-1,squadrons:state.squadrons.map(s=>s.id===id?{...s,readiness:Math.min(100,s.readiness+16)}:s)}}
export function repairDefense(state:MatchState,id:string):MatchState{return state.logistics<2?state:{...state,logistics:state.logistics-2,playerAssets:state.playerAssets.map(a=>a.id===id?{...a,health:Math.min(100,a.health+28)}:a)}}
export function repairRunway(state:MatchState):MatchState{return state.logistics<3||state.playerBaseHealth===100?state:{...state,logistics:state.logistics-3,playerBaseHealth:Math.min(100,state.playerBaseHealth+18)}}
