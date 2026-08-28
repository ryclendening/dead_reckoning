import { enemyBaseFor } from './data'
import type { Aggression, Asset, BehaviorInterval, CombatEvent, CombatExchange, CombatSequence, ContactInterval, ContactObservation, DebugScenario, DefenseCue, DetectionWindow, DoctrineLesson, EnemyFlight, FlightMode, FormationAttrition, IntelLevel, IntelReport, InterceptPlan, MatchState, Point, RadarTrackReceipt, ReinforcementCall, ReinforcementType, Role, RoundResult, Squadron, UnitFrame, WeaponEffect, WeaponKind } from './types'
import { boundarySegmentsObservedAt, intersectMovementWithWorld, mergeBoundarySegments, MAPPED_AREA_RADIUS } from './world'

export const SENSOR_RANGE: Record<Squadron['role'], number>={fighter:4.2,recon:4.9}
export const RADAR_RANGE=6.4
export const RADAR_COMMUNICATION_RANGE=11
export const EXECUTION_SECONDS=22
export const MAX_FLIGHT_DISTANCE:Record<Squadron['role'],number>={fighter:40,recon:48}
const FIGHTER_MERGE_RANGE=1.2
const ENCOUNTER_SAMPLE_SPACING=.16
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
function routeThroughProgress(route:Point[],progress:number,base:Point){
  if(route.length<2)return route
  const target=clamp(progress)*routeDistance(route);const partial:Point[]=[route[0]];let traveled=0
  for(let index=1;index<route.length;index++){
    const from=route[index-1],to=route[index],segment=distance(from,to)
    if(traveled+segment<target-.001){partial.push(to);traveled+=segment;continue}
    const fraction=segment===0?0:clamp((target-traveled)/segment);const point:Point=[from[0]+(to[0]-from[0])*fraction,from[1]+(to[1]-from[1])*fraction]
    if(distance(partial.at(-1)!,point)>.001)partial.push(point)
    break
  }
  if(distance(partial.at(-1)!,base)>.001)partial.push(base)
  return partial
}
function routePrefixAtDistance(route:Point[],target:number){
  if(route.length<2)return route
  const partial:Point[]=[route[0]];let traveled=0
  for(let index=1;index<route.length;index++){
    const from=route[index-1],to=route[index],segment=distance(from,to)
    if(traveled+segment<target-.001){partial.push(to);traveled+=segment;continue}
    const fraction=segment===0?0:clamp((target-traveled)/segment)
    const point:Point=[from[0]+(to[0]-from[0])*fraction,from[1]+(to[1]-from[1])*fraction]
    if(distance(partial.at(-1)!,point)>.001)partial.push(point)
    break
  }
  return partial
}
function pursuitRoute(route:Point[],role:Squadron['role'],start:number,destination:Point,base:Point){
  const partial=routePrefixAtDistance(route,start*MAX_FLIGHT_DISTANCE[role])
  if(distance(partial.at(-1)!,destination)>.001)partial.push(destination)
  if(distance(partial.at(-1)!,base)>.001)partial.push(base)
  return partial
}
function interceptPlanFor(squadron:Squadron,target:EnemyFlight,window:DetectionWindow,base:Point,source:'radar'|'visual'):({route:Point[];plan:InterceptPlan})|undefined{
  const start=Math.max(.02,window.start);const speed=MAX_FLIGHT_DISTANCE.fighter/EXECUTION_SECONDS;const origin=timedRoutePoint(squadron.route,'fighter',start)
  for(let progress=start;progress<=window.end+.0001;progress+=1/220){
    const targetPoint=timedRoutePoint(target.route,target.role,progress)
    if(distance(origin,targetPoint)>speed*(progress-start)+FIGHTER_MERGE_RANGE)continue
    const route=pursuitRoute(squadron.route,'fighter',start,targetPoint,base)
    if(routeDistance(route)>MAX_FLIGHT_DISTANCE.fighter+.001)continue
    return {route,plan:{squadronId:squadron.id,targetId:target.id,start:start*EXECUTION_SECONDS,end:progress*EXECUTION_SECONDS,source,outcome:'merge'}}
  }
  const lastKnown=timedRoutePoint(target.route,target.role,window.end);const availableDistance=Math.max(0,speed*(window.end-start));const bearing=distance(origin,lastKnown)
  const turnPoint:Point=bearing<.001?origin:[origin[0]+(lastKnown[0]-origin[0])*Math.min(1,availableDistance/bearing),origin[1]+(lastKnown[1]-origin[1])*Math.min(1,availableDistance/bearing)]
  const route=pursuitRoute(squadron.route,'fighter',start,turnPoint,base)
  if(routeDistance(route)>MAX_FLIGHT_DISTANCE.fighter+.001)return undefined
  return {route,plan:{squadronId:squadron.id,targetId:target.id,start:start*EXECUTION_SECONDS,end:window.end*EXECUTION_SECONDS,source,outcome:'lost-contact'}}
}
function timedRoutePoint(route:Point[],role:Squadron['role'],timeProgress:number){const length=Math.max(.001,routeDistance(route));return routePoint(route,Math.min(1,timeProgress*MAX_FLIGHT_DISTANCE[role]/length))}
function unitPositionAt(route:Point[],role:Squadron['role'],id:string,progress:number,sequences:CombatSequence[]){
  const seconds=progress*EXECUTION_SECONDS
  const activeDogfight=sequences.find(sequence=>sequence.kind==='dogfight'&&sequence.participantIds.includes(id)&&seconds>=sequence.start&&seconds<=sequence.end)
  if(activeDogfight)return activeDogfight.location
  const paused=sequences.filter(sequence=>sequence.kind==='dogfight'&&sequence.participantIds.includes(id)&&seconds>sequence.start).reduce((total,sequence)=>total+Math.max(0,Math.min(seconds,sequence.end)-sequence.start),0)
  return timedRoutePoint(route,role,Math.max(0,seconds-paused)/EXECUTION_SECONDS)
}
function aliveAt(id:string,progress:number,sequences:CombatSequence[]){
  const destruction=sequences.flatMap(sequence=>sequence.exchanges).filter(exchange=>exchange.defenderId===id&&exchange.targetStrength<=0).sort((a,b)=>a.time-b.time)[0]
  return !destruction||progress*EXECUTION_SECONDS<destruction.time
}
function sampledDetectionWindows(source:DetectionWindow['source'],detects:(progress:number)=>boolean,observer?:string){
  const windows:DetectionWindow[]=[];const steps=220;let start:number|undefined
  for(let index=0;index<=steps;index++){
    const progress=index/steps;const detected=detects(progress)
    if(detected&&start===undefined)start=progress
    if((!detected||index===steps)&&start!==undefined){windows.push({start,end:detected&&index===steps?1:Math.max(start,(index-1)/steps),source,observer});start=undefined}
  }
  return windows
}
function closestEncounter(first:Point[],firstRole:Squadron['role'],second:Point[],secondRole:Squadron['role']){
  const samples=Math.max(120,Math.ceil((MAX_FLIGHT_DISTANCE[firstRole]+MAX_FLIGHT_DISTANCE[secondRole])/ENCOUNTER_SAMPLE_SPACING))
  const at=(progress:number)=>{const friendlyPoint=timedRoutePoint(first,firstRole,progress);const hostilePoint=timedRoutePoint(second,secondRole,progress);return {progress,distance:distance(friendlyPoint,hostilePoint),friendlyPoint,hostilePoint}}
  let best=at(0)
  for(let index=1;index<=samples;index++){const candidate=at(index/samples);if(candidate.distance<best.distance)best=candidate}
  let low=Math.max(0,best.progress-1/samples),high=Math.min(1,best.progress+1/samples)
  for(let index=0;index<12;index++){const left=at((low*2+high)/3),right=at((low+high*2)/3);if(left.distance<=right.distance){high=right.progress;best=left.distance<best.distance?left:best}else{low=left.progress;best=right.distance<best.distance?right:best}}
  const friendlyProgress=Math.min(1,best.progress*MAX_FLIGHT_DISTANCE[firstRole]/Math.max(.001,routeDistance(first)))
  return {...best,point:[(best.friendlyPoint[0]+best.hostilePoint[0])/2,(best.friendlyPoint[1]+best.hostilePoint[1])/2] as Point,friendlyProgress}
}
function closestRouteProgress(route:Point[],point:Point){let best={distance:Infinity,progress:0,point:route[0]??[0,0] as Point};for(let i=0;i<=80;i++){const progress=i/80;const sample=routePoint(route,progress);const d=distance(sample,point);if(d<best.distance)best={distance:d,progress,point:sample}}return best}
function nearRoute(route:Point[],point:Point,radius:number){for(let i=1;i<route.length;i++){const a=route[i-1],b=route[i];const dx=b[0]-a[0],dy=b[1]-a[1];const t=clamp(((point[0]-a[0])*dx+(point[1]-a[1])*dy)/Math.max(.001,dx*dx+dy*dy));if(distance(point,[a[0]+dx*t,a[1]+dy*t])<=radius)return true}return false}
function playerBase(state:MatchState):Point{return state.playerAssets.find(a=>a.kind==='base')?.position??[-7.8,11.2]}
function enemyFlights(state:MatchState):EnemyFlight[]{const fighterRecon=state.debugScenario==='fighter-recon',enemyBase=enemyBaseFor(state.world),friendlyBase=playerBase(state);const toward=(factor:number):Point=>[enemyBase[0]+(friendlyBase[0]-enemyBase[0])*factor,enemyBase[1]+(friendlyBase[1]-enemyBase[1])*factor];const fighterTurn=toward(.56),reconTurn=toward(.7);return [
  {id:'red-fighter',callsign:'BOGEY 1',role:'fighter',aircraft:fighterRecon?0:4,initialAircraft:fighterRecon?0:4,strength:fighterRecon?0:100,morale:74,status:fighterRecon?'destroyed':'enroute',target:'decoy',route:[enemyBase,toward(.27),fighterTurn,toward(.4),fighterTurn,toward(.27),enemyBase],detectionWindows:[]},
  {id:'red-recon',callsign:'SPECTER',role:'recon',aircraft:2,initialAircraft:2,strength:100,morale:70,status:'enroute',target:'base',route:fighterRecon?[enemyBase,toward(.25),toward(.72),friendlyBase,toward(.72),toward(.25),enemyBase]:[enemyBase,toward(.3),reconTurn,toward(.38),reconTurn,toward(.3),enemyBase],detectionWindows:[]},
]}
function damage(unit:{strength?:number;morale?:number;aircraft:number;maxAircraft?:number;initialAircraft?:number},amount:number){const before=unit.aircraft;const max=unit.maxAircraft??unit.initialAircraft??before;unit.strength=Math.max(0,strengthOf(unit)-amount);unit.aircraft=aircraftFor(unit.strength,max);unit.morale=Math.max(0,(unit.morale??70)-8-(unit.aircraft<before?18:0));return {before,after:unit.aircraft,strength:unit.strength,morale:unit.morale}}
function weapon(id:string,kind:WeaponKind,sourceId:string,targetId:string,time:number,from:Point,to:Point,hit:boolean,amount:number):WeaponEffect{const travel=kind==='gun'||kind==='aaa' ? .34 : kind==='sam' ? 1.05 : .62;return {id,kind,sourceId,targetId,start:time,end:time+travel,from,to,hit,damage:amount}}

function dogfight(round:number,index:number,friendly:Squadron,hostile:EnemyFlight,location:Point,start:number,seed:number,add:(tone:CombatEvent['tone'],title:string,detail:string,position?:Point,time?:number)=>void){
  const exchanges:CombatExchange[]=[];const effects:WeaponEffect[]=[];let roll=seed
  add('danger','DOGFIGHT MERGED',`${friendly.callsign} and ${hostile.callsign} are committed until one formation is destroyed.`,location,start)
  let i=0
  while(strengthOf(friendly)>0&&strengthOf(hostile)>0&&i<24){
    const friendlyAttacks=rand(roll++)<.54+(friendly.readiness-80)/180;const attacker=friendlyAttacks?friendly:hostile;const defender=friendlyAttacks?hostile:friendly;const kind:WeaponKind=rand(roll++)<.45?'air-to-air-missile':'gun';const hit=rand(roll++)<.72;const amount=hit?(kind==='gun'?Math.round(12+rand(roll++)*7):Math.round(26+rand(roll++)*12)):0;const applied=hit?damage(defender,amount):{before:defender.aircraft,after:defender.aircraft,strength:strengthOf(defender),morale:defender.morale??70};const time=start+.35+i*.26
    exchanges.push({id:`fight-${round}-${index}-${i}`,time,attackerId:attacker.id,defenderId:defender.id,weapon:kind,damage:amount,moraleDamage:hit?8:0,hit,position:location,targetStrength:applied.strength,targetMorale:applied.morale})
    effects.push(weapon(`weapon-fight-${round}-${index}-${i}`,kind,attacker.id,defender.id,time-.16,[location[0]+(friendlyAttacks ? -.55 : .55),location[1]+.2],[location[0]+(friendlyAttacks ? .5 : -.5),location[1]-.2],hit,amount))
    if(hit&&applied.after<applied.before)add(friendlyAttacks?'friendly':'danger',friendlyAttacks?'ENEMY AIRCRAFT LOST':'AIRCRAFT LOST',friendlyAttacks?`${hostile.callsign} loses an aircraft.`:`${friendly.callsign} loses an aircraft.`,location,time+.18)
    else if(hit)add(friendlyAttacks?'friendly':'warning','DAMAGE REPORTED',`${defender.callsign} takes ${amount}% formation damage.`,location,time+.18)
    i++
  }
  if(strengthOf(friendly)>0&&strengthOf(hostile)>0){
    const defender=strengthOf(friendly)<=strengthOf(hostile)?friendly:hostile;const attacker=defender===friendly?hostile:friendly;const friendlyAttacks=attacker===friendly;const amount=Math.ceil(strengthOf(defender))+1;const time=start+.35+i*.26;const applied=damage(defender,amount)
    exchanges.push({id:`fight-${round}-${index}-${i}`,time,attackerId:attacker.id,defenderId:defender.id,weapon:'air-to-air-missile',damage:amount,moraleDamage:8,hit:true,position:location,targetStrength:applied.strength,targetMorale:applied.morale})
    effects.push(weapon(`weapon-fight-${round}-${index}-${i}`,'air-to-air-missile',attacker.id,defender.id,time-.16,[location[0]+(friendlyAttacks ? -.55 : .55),location[1]+.2],[location[0]+(friendlyAttacks ? .5 : -.5),location[1]-.2],true,amount))
    add(friendlyAttacks?'friendly':'danger',friendlyAttacks?'ENEMY AIRCRAFT LOST':'AIRCRAFT LOST',`${defender.callsign} loses its remaining aircraft.`,location,time+.18)
  }
  friendly.status=strengthOf(friendly)<=0?'destroyed':'rtb';hostile.status=strengthOf(hostile)<=0?'destroyed':'rtb'
  const reason=friendly.status==='destroyed'?`${friendly.callsign} destroyed`: `${hostile.callsign} destroyed`
  const end=start+Math.min(7,Math.max(4.2,exchanges.length*.26+1))
  add(hostile.status==='destroyed'?'friendly':'danger','DOGFIGHT ENDS',reason,location,end-.25)
  return {sequence:{id:`dogfight-${round}-${index}`,kind:'dogfight' as const,participantIds:[friendly.id,hostile.id],location,start,end,exchanges,finalDisposition:{[friendly.id]:friendly.status,[hostile.id]:hostile.status},moraleBreakReason:reason},effects,roll}
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
  add('warning','RECON PRESSES ON',`${recon.callsign} accepts fighter pursuit and continues the collection route under AGGRESSIVE doctrine.`,location,start)
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

type SimUnit={id:string;callsign:string;role:Role;aggression:Aggression;friendly:boolean;position:Point;facing:Point;route:Point[];waypoint:number;mode:FlightMode;targetId?:string;lastKnown?:Point;strength:number;morale:number;aircraft:number;maxAircraft:number;traveled:number;frames:UnitFrame[];observed:Set<string>;boundaryObservations:import('./types').BoundarySegment[];source:Squadron|EnemyFlight}
type AirContact={target:SimUnit;source:'radar'|'visual'}
type TransitionUnit=(unit:SimUnit,mode:FlightMode,time:number,reason:string,targetId?:string,source?:'radar'|'visual')=>void
type AddCombatEvent=(tone:CombatEvent['tone'],title:string,detail:string,position?:Point,time?:number)=>void
type EngagementKind='dogfight'|'pursuit'
interface EngagementRule {kind:EngagementKind;startRange:number;requiresAggressive?:boolean}
interface ActiveEngagement {kind:EngagementKind;attacker:SimUnit;target:SimUnit;location:Point;start:number;nextExchange:number;exchanges:CombatExchange[];effects:WeaponEffect[]}
interface EngagementUpdate {active?:ActiveEngagement;roll:number;sequence?:CombatSequence;effects:WeaponEffect[]}
const TICK_SECONDS=.05
const point=(a:Point,b:Point,d:number):Point=>{const l=distance(a,b);return l<=d?[...b] as Point:[a[0]+(b[0]-a[0])*d/l,a[1]+(b[1]-a[1])*d/l]}
const terminal=(u:SimUnit)=>u.mode==='recovered'||u.mode==='destroyed'
const AIR_ENGAGEMENT_RULES:Record<Role,Partial<Record<Role,EngagementRule>>>={
  fighter:{fighter:{kind:'dogfight',startRange:FIGHTER_MERGE_RANGE},recon:{kind:'pursuit',startRange:FIGHTER_MERGE_RANGE}},
  recon:{},
}

function engagementRuleFor(attacker:SimUnit,target:SimUnit){return AIR_ENGAGEMENT_RULES[attacker.role][target.role]}
function canAcquireAirTarget(unit:SimUnit,contact:AirContact){
  if(unit.role!=='fighter'||terminal(contact.target))return false
  return contact.target.role==='fighter' ? unit.aggression==='aggressive'||contact.source==='visual' : unit.aggression!=='neutral'
}
function selectAirTarget(unit:SimUnit,contacts:AirContact[]){
  const priority=(contact:AirContact)=>contact.target.role==='recon'&&distance(unit.position,contact.target.position)<=FIGHTER_MERGE_RANGE?-1:contact.target.role==='fighter'?0:1
  return contacts.filter(contact=>canAcquireAirTarget(unit,contact)).sort((a,b)=>priority(a)-priority(b)||distance(unit.position,a.target.position)-distance(unit.position,b.target.position))[0]
}
function hasFuelForIntercept(unit:SimUnit,target:SimUnit,base:Point){return unit.traveled+distance(unit.position,target.position)+distance(target.position,base)<=MAX_FLIGHT_DISTANCE.fighter}

function startAirEngagement(attacker:SimUnit,target:SimUnit,time:number,transition:TransitionUnit,add:AddCombatEvent){
  const rule=engagementRuleFor(attacker,target)
  if(!rule||attacker.mode!=='intercepting'||terminal(target)||distance(attacker.position,target.position)>rule.startRange||rule.requiresAggressive&&attacker.aggression!=='aggressive')return undefined
  const location:Point=[(attacker.position[0]+target.position[0])/2,(attacker.position[1]+target.position[1])/2]
  if(rule.kind==='dogfight'){
    transition(attacker,'dogfighting',time,'merge',target.id,'visual');transition(target,'dogfighting',time,'merge',attacker.id,'visual');add('danger','DOGFIGHT COMMITS',`${attacker.callsign} merges with ${target.callsign}.`,location,time)
  }else{
    transition(attacker,'attacking-recon',time,'recon-intercept',target.id,'visual');attacker.lastKnown=[...target.position] as Point;add('friendly','RECON UNDER PURSUIT',`${attacker.callsign} pursues ${target.callsign}; weapons fire only while the recon flight remains in close range.`,location,time)
  }
  return {kind:rule.kind,attacker,target,location,start:time,nextExchange:time,exchanges:[],effects:[]} satisfies ActiveEngagement
}

function updateDogfightEngagement(engagement:ActiveEngagement,time:number,roll:number,index:number,transition:TransitionUnit,add:AddCombatEvent):EngagementUpdate{
  if(time<engagement.nextExchange)return {active:engagement,roll,effects:[]}
  const attacker=engagement.exchanges.length%2?engagement.target:engagement.attacker;const defender=attacker===engagement.attacker?engagement.target:engagement.attacker;const hit=rand(++roll)>.31;const amount=hit?22:0
  const applied=hit?damage(defender,amount):{strength:defender.strength,morale:defender.morale};engagement.exchanges.push({id:`fight-${engagement.exchanges.length}`,time,attackerId:attacker.id,defenderId:defender.id,weapon:'gun',damage:amount,moraleDamage:amount*.6,hit,position:engagement.location,targetStrength:applied.strength,targetMorale:applied.morale});engagement.nextExchange=time+.35
  if(defender.strength>0&&engagement.exchanges.length<8)return {active:engagement,roll,effects:[]}
  if(defender.strength>0){const finishingDamage=Math.ceil(defender.strength);defender.strength=0;defender.morale=0;defender.aircraft=0;engagement.exchanges.push({id:`fight-${engagement.exchanges.length}`,time:time+.01,attackerId:attacker.id,defenderId:defender.id,weapon:'air-to-air-missile',damage:finishingDamage,moraleDamage:finishingDamage*.6,hit:true,position:engagement.location,targetStrength:0,targetMorale:0})}
  defender.aircraft=0;transition(defender,'destroyed',time,'dogfight-loss');transition(attacker,'following-route',time,'dogfight-complete');add('friendly','DOGFIGHT ENDS',`${attacker.callsign} destroys ${defender.callsign} and resumes the mission.`,engagement.location,time)
  return {roll,effects:[],sequence:{id:`dogfight-${index}`,kind:'dogfight',participantIds:[engagement.attacker.id,engagement.target.id],location:engagement.location,start:engagement.start,end:time,exchanges:engagement.exchanges,finalDisposition:{[engagement.attacker.id]:engagement.attacker.mode==='destroyed'?'destroyed':'enroute',[engagement.target.id]:engagement.target.mode==='destroyed'?'destroyed':'enroute'}}}
}

function updatePursuitEngagement(engagement:ActiveEngagement,time:number,roll:number,round:number,index:number,transition:TransitionUnit,add:AddCombatEvent):EngagementUpdate{
  const range=distance(engagement.attacker.position,engagement.target.position);const canStrike=!terminal(engagement.target)&&engagement.attacker.mode==='attacking-recon'&&range<=FIGHTER_MERGE_RANGE
  if(canStrike&&time>=engagement.nextExchange){const kind:WeaponKind=engagement.exchanges.length%2===0?'air-to-air-missile':'gun';const hit=rand(roll++)<.68;const amount=hit?(kind==='gun'?Math.round(12+rand(roll++)*7):Math.round(26+rand(roll++)*12)):0;const applied=hit?damage(engagement.target,amount):{strength:engagement.target.strength,morale:engagement.target.morale};engagement.exchanges.push({id:`pursuit-${round}-${index}-${engagement.exchanges.length}`,time,attackerId:engagement.attacker.id,defenderId:engagement.target.id,weapon:kind,damage:amount,moraleDamage:hit?8:0,hit,position:[...engagement.target.position] as Point,targetStrength:applied.strength,targetMorale:applied.morale});engagement.effects.push(weapon(`weapon-pursuit-${engagement.exchanges.length}`,kind,engagement.attacker.id,engagement.target.id,time-.16,[...engagement.attacker.position] as Point,[...engagement.target.position] as Point,hit,amount));engagement.nextExchange=time+.5
    if(engagement.target.aircraft<=0){transition(engagement.target,'destroyed',time,'fighter-pursuit');add('friendly','RECON DESTROYED',`${engagement.attacker.callsign} destroys ${engagement.target.callsign} in pursuit.`,engagement.target.position,time)}
  }
  const escaped=!terminal(engagement.target)&&range>effectiveSensorRange(engagement.attacker.source as Squadron);const complete=terminal(engagement.target)||engagement.exchanges.length>=4||escaped||engagement.attacker.mode!=='attacking-recon'
  if(!complete)return {active:engagement,roll,effects:[]}
  if(engagement.attacker.mode==='attacking-recon'){
    // Pursuit is only a temporary diversion. Resume the assigned CAP/patrol
    // route after either outcome; the normal movement fuel-reserve check will
    // transition the fighter to recovery if the diversion used its remaining
    // range.
    transition(engagement.attacker,'following-route',time,terminal(engagement.target)?'recon-destroyed':'recon-escaped')
  }
  if(!terminal(engagement.target))add('warning','RECON ESCAPES PURSUIT',`${engagement.target.callsign} opens the distance and continues its mission.`,engagement.target.position,time)
  return {roll,effects:engagement.effects,sequence:{id:`pursuit-${index}`,kind:'pursuit',participantIds:[engagement.attacker.id,engagement.target.id],location:engagement.location,start:engagement.start,end:time,exchanges:engagement.exchanges,finalDisposition:{[engagement.attacker.id]:engagement.attacker.mode==='destroyed'?'destroyed':'rtb',[engagement.target.id]:engagement.target.mode==='destroyed'?'destroyed':'enroute'}}}
}

function updateAirEngagement(engagement:ActiveEngagement,time:number,roll:number,round:number,index:number,transition:TransitionUnit,add:AddCombatEvent){
  return engagement.kind==='dogfight'?updateDogfightEngagement(engagement,time,roll,index,transition,add):updatePursuitEngagement(engagement,time,roll,round,index,transition,add)
}

function simulateRound(state:MatchState):RoundResult{
  const base=playerBase(state); const enemyBase=enemyBaseFor(state.world); const assets=structuredClone(state.enemyAssets); const playerAssets=structuredClone(state.playerAssets); const squadrons=structuredClone(state.squadrons); const flights=enemyFlights(state);
  const events:CombatEvent[]=[]; const sequences:CombatSequence[]=[]; const effects:WeaponEffect[]=[]; const observations:ContactObservation[]=[]; const receipts:RadarTrackReceipt[]=[]; const plans:InterceptPlan[]=[]; const intelReports:IntelReport[]=[]; const intervals:ContactInterval[]=[]; const behavior:BehaviorInterval[]=[]; const add=(tone:CombatEvent['tone'],title:string,detail:string,position?:Point,time=0)=>events.push({id:`${state.round}-${events.length}`,tone,title,detail,position,time});
  const make=(s:Squadron|EnemyFlight,friendly:boolean):SimUnit=>({id:s.id,callsign:s.callsign,role:s.role,aggression:friendly?(s as Squadron).aggression:'aggressive',friendly,position:[...s.route[0]] as Point,facing:[...s.route[1]??s.route[0]] as Point,route:friendly?ensureRecovery(s.route,base):s.route,waypoint:1,mode:(s.aircraft??0)>0?'following-route':'destroyed',strength:strengthOf(s),morale:s.morale??70,aircraft:s.aircraft,maxAircraft:friendly?(s as Squadron).maxAircraft:(s as EnemyFlight).initialAircraft,traveled:0,frames:[],observed:new Set,boundaryObservations:[],source:s})
  const units=[...squadrons.map(s=>make(s,true)),...flights.map(s=>make(s,false))]; const byId=new Map(units.map(u=>[u.id,u])); const openContacts=new Map<string,ContactInterval>(); const openReceipts=new Map<string,RadarTrackReceipt>(); const radarSince=new Map<string,number>(); const openBehavior=new Map<string,BehaviorInterval>(); const fired=new Set<string>(); let roll=state.seed+state.round*31; let activeEngagement:ActiveEngagement|undefined
  const transition=(u:SimUnit,mode:FlightMode,time:number,reason:string,targetId?:string,source?:'radar'|'visual')=>{if(u.mode===mode&&u.targetId===targetId)return;const old=openBehavior.get(u.id);if(old)old.end=time;u.mode=mode;u.targetId=targetId;const item:BehaviorInterval={id:`behavior-${behavior.length}`,unitId:u.id,mode,start:time,end:time,targetId,source,reason};behavior.push(item);openBehavior.set(u.id,item)}
  const record=(time:number)=>units.forEach(u=>u.frames.push({time,position:[...u.position] as Point,facing:[...u.facing] as Point,mode:u.mode,strength:u.strength,morale:u.morale,aircraft:u.aircraft,traveledDistance:u.traveled}))
  const contact=(observerId:string,targetId:string,source:'radar'|'visual',position:Point,active:boolean,time:number)=>{const key=`${observerId}:${targetId}:${source}`;const old=openContacts.get(key);if(active&&!old){const x={id:`contact-${intervals.length}`,observerId,targetId,source,start:time,end:time,position:[...position] as Point};intervals.push(x);openContacts.set(key,x)}else if(active&&old)old.end=time;else if(!active&&old){old.end=time;openContacts.delete(key)}}
  add('info','SORTIES AIRBORNE',`${units.filter(u=>u.friendly).reduce((n,u)=>n+u.aircraft,0)} aircraft committed.`,undefined,.8)
  for(const u of units)transition(u,u.mode,0,'round-start')
  record(0)
  for(let time=TICK_SECONDS;time<=60+1e-6;time+=TICK_SECONDS){
    // 1-2: fixed speed motion and fuel reserve.
    for(const u of units){if(terminal(u)||u.mode==='dogfighting')continue;const home=u.friendly?base:enemyBase;let destination:Point=u.position
      if(u.mode==='following-route')destination=u.route[u.waypoint] as never; else if(u.mode==='recovering')destination=home as never; else if(u.mode==='intercepting'){const target=u.targetId?byId.get(u.targetId):undefined;destination=(target?.position??u.lastKnown??home) as never}else if(u.mode==='pursuing-last-known')destination=(u.lastKnown??home) as never
      else if(u.mode==='attacking-recon'){const target=u.targetId?byId.get(u.targetId):undefined;destination=(target?.position??u.lastKnown??home) as never}
      if(!destination){transition(u,'recovering',time,'route-complete');continue} const step=MAX_FLIGHT_DISTANCE[u.role]/EXECUTION_SECONDS*TICK_SECONDS; const next=point(u.position,destination,step); const moved=distance(u.position,next)
      if(u.friendly&&u.mode!=='recovering'&&u.traveled+moved+distance(next,base)>MAX_FLIGHT_DISTANCE[u.role]+.001){transition(u,'recovering',time,'fuel-reserve');continue}
      const edgeHit=intersectMovementWithWorld(u.position,next,state.world.bounds)
      if(edgeHit){const edgeDistance=distance(u.position,edgeHit.point);u.facing=destination;u.position=edgeHit.point;u.traveled+=edgeDistance;if(u.friendly&&u.role==='recon'){u.boundaryObservations.push(...boundarySegmentsObservedAt(edgeHit.point,MAPPED_AREA_RADIUS,state.world.bounds));add('warning','WORLD EDGE OBSERVED',`${u.callsign} reaches an unknown world boundary and turns for home.`,edgeHit.point,time)}transition(u,'recovering',time,'world-edge');continue}
      u.facing=destination;u.position=next;u.traveled+=moved
      if(distance(u.position,destination)<.03){u.position=[...destination] as Point;if(u.mode==='following-route'){u.waypoint++;if(u.waypoint>=u.route.length)transition(u,'recovering',time,'route-complete')}else if(u.mode==='pursuing-last-known')transition(u,'recovering',time,'last-known-reached');else if(u.mode==='recovering')transition(u,'recovered',time,'home-reached')}
    }
    // 3: contacts and actual communications. A radar receipt is a
    // friendly-network product, not a generic consequence of being inside any
    // radar's coverage. Hostile radar can threaten a friendly flight, but it
    // cannot publish its tracks into the player's network.
    const current=new Map<string,AirContact[]>(); const radar=playerAssets.find(a=>a.kind==='radar'&&a.health>0)
    for(const friendly of units.filter(u=>u.friendly&&!terminal(u))){const seen:AirContact[]=[];for(const enemy of units.filter(u=>!u.friendly&&!terminal(u))){const visual=distance(friendly.position,enemy.position)<=effectiveSensorRange(friendly.source as Squadron);contact(friendly.id,enemy.id,'visual',enemy.position,visual,time);if(visual)seen.push({target:enemy,source:'visual'}); // `radar` is selected only from playerAssets; enemy radar never enters this link.
      const linked=!!radar&&distance(radar.position,enemy.position)<=RADAR_RANGE&&distance(friendly.position,radar.position)<=RADAR_COMMUNICATION_RANGE;contact(friendly.id,enemy.id,'radar',enemy.position,linked,time);const key=`${friendly.id}:${enemy.id}`;const receipt=openReceipts.get(key);if(linked){if(receipt)receipt.end=time;else{const next={id:`receipt-${receipts.length}`,radarId:radar!.id,receiverId:friendly.id,targetId:enemy.id,start:time,end:time};receipts.push(next);openReceipts.set(key,next)}seen.push({target:enemy,source:'radar'})}else if(receipt)openReceipts.delete(key)}current.set(friendly.id,seen)}
    // 4-5 doctrine, pursuit, merge.
    for(const u of units.filter(u=>u.friendly&&!terminal(u)&&u.mode!=='dogfighting'&&u.mode!=='attacking-recon'&&u.mode!=='recovering')){const seen=current.get(u.id)??[];const choice=selectAirTarget(u,seen)
      const hostileVisual=seen.find(x=>x.source==='visual'&&x.target.role==='fighter');const radarReceipt=seen.some(x=>x.source==='radar');if(radarReceipt&&!radarSince.has(u.id))radarSince.set(u.id,time);if(!radarReceipt)radarSince.delete(u.id)
      if(u.role==='recon'&&u.aggression==='conservative'&&radarSince.has(u.id)&&time-radarSince.get(u.id)!>=1){transition(u,'recovering',time,'persistent-radar-threat');add('warning','RECON ABORTS ON RADAR',`${u.callsign} aborts after a persistent radar threat under CONSERVATIVE doctrine.`,u.position,time);continue}
      if(u.role==='recon'&&hostileVisual&&u.aggression!=='aggressive'){transition(u,'recovering',time,u.aggression==='conservative'?'conservative-intercept':'neutral-visual-intercept',hostileVisual.target.id,'visual');add('warning','RECON BREAKS CONTACT',`${u.callsign} aborts collection after direct fighter contact under ${u.aggression.toUpperCase()} doctrine.`,u.position,time);continue}
      if(u.role==='recon'&&hostileVisual&&u.aggression==='aggressive'&&!events.some(event=>event.title==='RECON PRESSES ON'&&event.detail.includes(u.callsign)))add('warning','RECON PRESSES ON',`${u.callsign} continues collection under AGGRESSIVE doctrine despite direct fighter contact.`,u.position,time)
      const expectedCombat=seen.some(contact=>contact.target.role==='fighter')
      if(u.role==='fighter'&&u.aggression==='conservative'&&expectedCombat){transition(u,'recovering',time,'conservative-combat-avoidance');add('info','FIGHTER AVOIDS COMBAT',`${u.callsign} recovers rather than accepting fighter combat under CONSERVATIVE doctrine.`,u.position,time);continue}
      if(choice){if(hasFuelForIntercept(u,choice.target,base)){if(u.mode!=='intercepting'||u.targetId!==choice.target.id){transition(u,'intercepting',time,choice.source==='visual'?'visual-contact':'radar-receipt',choice.target.id,choice.source);plans.push({squadronId:u.id,targetId:choice.target.id,start:time,end:time,source:choice.source,outcome:'merge'});add('friendly','FIGHTER INTERCEPT',`${u.callsign} diverts on a ${choice.source.toUpperCase()} track.`,u.position,time)}u.lastKnown=[...choice.target.position] as Point}else transition(u,'recovering',time,'fuel-reserve')}else if(u.mode==='intercepting'){transition(u,'pursuing-last-known',time,'track-lost',u.targetId);add('warning','FIGHTER TRACK LOST',`${u.callsign} continues to the last known position.`,u.lastKnown,time)}
    }
    if(!activeEngagement)for(const attacker of units.filter(u=>u.friendly&&u.role==='fighter'&&u.mode==='intercepting')){const target=attacker.targetId?byId.get(attacker.targetId):undefined;if(!target)continue;const started=startAirEngagement(attacker,target,time,transition,add);if(started){activeEngagement=started;break}}
    // 6-7: tick-level defenses, impacts (instant deterministic impact at range entry).
    for(const asset of [...assets,...playerAssets].filter((a):a is Asset&{kind:'sam'|'aaa'}=>a.kind==='sam'||a.kind==='aaa'))for(const target of units.filter(u=>!terminal(u)&&u.friendly===assets.includes(asset))){const range=asset.kind==='sam'?3.2:1.9;const key=`${asset.id}:${target.id}`;if(!fired.has(key)&&distance(asset.position,target.position)<=range){fired.add(key);if(target.friendly&&target.role==='recon'&&target.aggression!=='aggressive'){transition(target,'recovering',time,'air-defense-launch');add('warning','RECON BREAKS FOR THREAT',`${target.callsign} recovers after ${asset.kind.toUpperCase()} launch under ${target.aggression.toUpperCase()} doctrine.`,target.position,time)}roll+=1;const hit=rand(roll)>(asset.kind==='sam'?.36:.48);const damage=asset.kind==='sam'?38:13;effects.push({id:`weapon-${effects.length}`,kind:asset.kind,sourceId:asset.id,targetId:target.id,start:time,end:time+.28,from:asset.position,to:[...target.position] as Point,hit,damage});const ex:CombatExchange={id:`defense-${effects.length}`,time:time+.28,attackerId:asset.id,defenderId:target.id,weapon:asset.kind,damage,moraleDamage:damage*.45,hit,position:[...target.position] as Point,targetStrength:target.strength,targetMorale:target.morale};if(hit){target.strength=Math.max(0,target.strength-damage);target.morale=Math.max(0,target.morale-damage*.45);if(target.friendly&&target.role==='recon'&&target.aggression==='aggressive'&&target.strength<50&&target.strength>0){transition(target,'recovering',time+.28,'aggressive-damage-threshold');add('warning','RECON DAMAGE BREAK',`${target.callsign} falls below 50% strength and recovers.`,target.position,time+.28)}if(target.strength<=0){target.aircraft=0;transition(target,'destroyed',time+.28,'defense-hit');add(target.friendly?'danger':'friendly',target.friendly?'AIRCRAFT LOST':'ENEMY AIRCRAFT LOST',`${target.callsign} is destroyed by ${asset.kind.toUpperCase()}.`,target.position,time+.28)}}sequences.push({id:`defense-${sequences.length}`,kind:'defense',participantIds:[asset.id,target.id],location:[...target.position] as Point,start:time,end:time+.28,exchanges:[ex],finalDisposition:{[target.id]:target.mode==='destroyed'?'destroyed':'enroute'}})}}
    // Every damage source updates strength first; this single conversion keeps the aircraft-pip model authoritative.
    for(const unit of units)unit.aircraft=aircraftFor(unit.strength,unit.maxAircraft)
    if(activeEngagement){const update=updateAirEngagement(activeEngagement,time,roll,state.round,sequences.length,transition,add);roll=update.roll;activeEngagement=update.active;if(update.sequence)sequences.push(update.sequence);effects.push(...update.effects)}
    for(const recon of units.filter(u=>u.friendly&&u.role==='recon'&&!terminal(u)))for(const asset of assets)if(distance(recon.position,asset.position)<=3.8)recon.observed.add(asset.id)
    if(Math.round(time*10)%1===0 && Math.abs((time*10)-Math.round(time*10))<.001)record(time)
    if(time>=22&&units.every(terminal)&&!activeEngagement)break
  }
  const duration=Math.min(60,units.reduce((m,u)=>Math.max(m,u.frames.at(-1)?.time??0),22));for(const x of openContacts.values())x.end=duration;for(const x of openBehavior.values())x.end=duration
  for(const receipt of openReceipts.values())receipt.end=duration
  for(const flight of flights){const cs=intervals.filter(i=>i.targetId===flight.id);flight.detectionWindows=cs.map(i=>({start:i.start/duration,end:i.end/duration,source:i.source,observer:i.observerId}));flight.identityLearnedAt=cs.find(i=>i.source==='visual')?.start}
  const recoveredRecon=units.filter(u=>u.friendly&&u.role==='recon'&&u.mode==='recovered')
  const discoveredBoundaries=mergeBoundarySegments([],recoveredRecon.flatMap(u=>u.boundaryObservations))
  const existingBoundaries=mergeBoundarySegments([],state.discoveredBoundaries??[]),combinedBoundaries=mergeBoundarySegments(existingBoundaries,discoveredBoundaries)
  if(JSON.stringify(combinedBoundaries)!==JSON.stringify(existingBoundaries))add('friendly','WORLD EDGE DISCOVERED','Recovered reconnaissance confirms a section of the world boundary.',undefined,duration)
  for(const u of units.filter(u=>u.friendly)){const s=squadrons.find(x=>x.id===u.id)!;Object.assign(s,{aircraft:u.aircraft,strength:u.strength,morale:u.morale,status:u.mode==='destroyed'?'destroyed':'rtb',readiness:Math.max(25,s.readiness-(u.role==='fighter'?12:7)),ammo:Math.max(0,s.ammo-(u.role==='fighter'?28:8))});if(u.role==='recon')for(const id of u.observed){const asset=assets.find(a=>a.id===id)!;const recovered=u.mode==='recovered';const newlyDiscovered=asset.intel==='unknown';if(newlyDiscovered)intelReports.push({id:`intel-${id}`,observerId:u.id,assetId:id,confidence:90,recovered,detail:`${u.callsign} ${recovered?'recovered':'did not recover'} observation of ${asset.kind}.`});if(recovered){asset.confidence=Math.max(90,asset.confidence);asset.intel=levelFor(asset.confidence);asset.hidden=false;if(newlyDiscovered)add('friendly','INTEL RECOVERED',`${u.callsign} returns with ${asset.kind.toUpperCase()} coordinates.`,asset.position,duration)}else if(newlyDiscovered)add('danger','INTEL LOST',`${u.callsign}'s observation did not return.`,asset.position,duration)}}
  for(const f of flights){const u=byId.get(f.id)!;Object.assign(f,{aircraft:u.aircraft,strength:u.strength,morale:u.morale,status:u.mode==='destroyed'?'destroyed':'rtb'})}
  add('friendly',duration>=60?'ROUND TIME CAP':'RECOVERY COMPLETE',duration>=60?'Airborne formations retain an unresolved recovery disposition.':'Surviving formations completed recovery.',base,duration);events.sort((a,b)=>a.time-b.time)
  const executionRoutes=Object.fromEntries(units.map(u=>[u.id,u.frames.map(f=>f.position)]));const mappedAreas=recoveredRecon.flatMap(u=>sampleRoute(executionRoutes[u.id])).filter(point=>point[0]>=state.world.bounds.minX&&point[0]<=state.world.bounds.maxX&&point[1]>=state.world.bounds.minZ&&point[1]<=state.world.bounds.maxZ);const confirmedEnemyIds=new Set(sequences.flatMap(sequence=>sequence.exchanges.filter(exchange=>exchange.hit&&exchange.damage>0&&flights.some(flight=>flight.id===exchange.defenderId)).map(exchange=>exchange.defenderId)));const friendlyAttrition=deriveFormationAttrition(state.squadrons,squadrons);const enemyAttrition=deriveFormationAttrition(flights.map(flight=>({...flight,aircraft:flight.initialAircraft})),flights,confirmedEnemyIds);const friendlyLosses=friendlyAttrition.reduce((total,item)=>total+item.aircraftLost,0);const enemyLosses=enemyAttrition.filter(item=>item.confirmed).reduce((total,item)=>total+item.aircraftLost,0);const result:RoundResult={duration,tickSeconds:TICK_SECONDS,unitTracks:units.map(u=>({unitId:u.id,frames:u.frames})),contactIntervals:intervals,behaviorIntervals:behavior,events,squadrons,assets,enemyLosses,friendlyLosses,friendlyAttrition,enemyAttrition,friendlyFormationsDestroyed:friendlyAttrition.filter(item=>item.destroyed).length,enemyFormationsDestroyed:enemyAttrition.filter(item=>item.destroyed&&item.confirmed).length,intelGained:intelReports.filter(x=>x.recovered).map(x=>x.detail),baseDamage:0,enemyBaseDamage:0,logistics:Math.min(15,state.logistics+4),command:Math.min(3,state.command+1),executionRoutes,enemyFlights:flights,defenseCues:[],defensiveAwareness:0,lessons:events.filter(e=>['DOGFIGHT ENDS','FIGHTER TRACK LOST','INTEL RECOVERED','INTEL LOST','WORLD EDGE DISCOVERED'].includes(e.title)).slice(0,4).map(e=>({title:e.title,detail:e.detail,tone:e.tone==='danger'?'danger':e.tone==='warning'?'warning':'friendly'})),playerAssets,reinforcementCalls:[],roundScore:0,baseExposure:state.baseExposure,baseExposureDelta:0,combatSequences:sequences,weaponEffects:effects,contactObservations:observations,radarTrackReceipts:receipts,interceptPlans:plans,intelReports,mappedAreas,discoveredBoundaries};result.roundScore=battleScoreAt(result,Infinity);return result
}

export function resolveRound(state:MatchState):RoundResult{
  return simulateRound(state)
  /* legacy prediction resolver retained in source history; replaced by the fixed-step simulator.
  const base=playerBase(state);const squadrons:Squadron[]=structuredClone(state.squadrons).map(s=>({...s,strength:strengthOf(s),morale:s.morale??70,status:'enroute'}));const assets=structuredClone(state.enemyAssets);const playerAssets=structuredClone(state.playerAssets);const flights=enemyFlights();const events:CombatEvent[]=[];const add=(tone:CombatEvent['tone'],title:string,detail:string,position?:Point,time=2)=>events.push({id:`${state.round}-${events.length}`,tone,title,detail,position,time});const executionRoutes:Record<string,Point[]>={};const combatSequences:CombatSequence[]=[];const weaponEffects:WeaponEffect[]=[];const contactObservations:ContactObservation[]=[];const radarTrackReceipts:RadarTrackReceipt[]=[];const interceptPlans:InterceptPlan[]=[];const intelReports:IntelReport[]=[];const defenseCues:DefenseCue[]=[];const mappedAreas:Point[]=[];let roll=state.seed+state.round*31
  add('info','SORTIES AIRBORNE',`${squadrons.reduce((total,s)=>total+s.aircraft,0)} aircraft committed: fighters protect, recon observes.`,undefined,.8)
  for(const sq of squadrons)executionRoutes[sq.id]=ensureRecovery(sq.route,base)
  const radar=playerAssets.find(asset=>asset.kind==='radar'&&asset.health>0)
  const plannedRadarWindows=new Map<string,DetectionWindow[]>()
  const plannedReceipts=new Map<string,DetectionWindow[]>()
  const plannedVisuals=new Map<string,DetectionWindow[]>()
  for(const flight of flights){
    const radarWindows=radar?sampledDetectionWindows('radar',progress=>distance(timedRoutePoint(flight.route,flight.role,progress),radar.position)<=RADAR_RANGE,'GROUND RADAR'):[]
    plannedRadarWindows.set(flight.id,radarWindows)
    for(const squadron of squadrons){
      const receipt=radar?sampledDetectionWindows('radar',progress=>radarWindows.some(window=>progress>=window.start&&progress<=window.end)&&distance(timedRoutePoint(squadron.route,squadron.role,progress),radar.position)<=RADAR_COMMUNICATION_RANGE,squadron.callsign):[]
      plannedReceipts.set(`${squadron.id}:${flight.id}`,receipt)
      const visual=sampledDetectionWindows('visual',progress=>distance(timedRoutePoint(squadron.route,squadron.role,progress),timedRoutePoint(flight.route,flight.role,progress))<=effectiveSensorRange(squadron),squadron.callsign)
      plannedVisuals.set(`${squadron.id}:${flight.id}`,visual)
    }
  }
  const plannedInterceptions=new Map<string,{target:EnemyFlight;route:Point[];plan:InterceptPlan}>()
  for(const squadron of squadrons.filter(s=>s.role==='fighter'&&s.aircraft>0)){
    // Deterministic target priority: hostile fighters before hostile recon, then first valid current track.
    for(const target of [...flights].sort((a,b)=>(a.role==='fighter'?0:1)-(b.role==='fighter'?0:1))){
      const radarWindows=plannedReceipts.get(`${squadron.id}:${target.id}`)??[]
      const visualWindows=plannedVisuals.get(`${squadron.id}:${target.id}`)??[]
      const contacts:(DetectionWindow&{contactSource:'radar'|'visual'})[]=squadron.aggression==='aggressive'
        ? [...radarWindows.map(window=>({...window,contactSource:'radar' as const})),...visualWindows.map(window=>({...window,contactSource:'visual' as const}))].sort((a,b)=>a.start-b.start)
        : visualWindows.map(window=>({...window,contactSource:'visual' as const}))
      const candidates=contacts.map(contact=>interceptPlanFor(squadron,target,contact,base,contact.contactSource)).filter((candidate):candidate is {route:Point[];plan:InterceptPlan}=>Boolean(candidate))
      // A current visual merge wins over a radar-only chase that would lose contact first.
      const candidate=candidates.find(option=>option.plan.outcome==='merge')??candidates[0]
      if(candidate){plannedInterceptions.set(squadron.id,{target,route:candidate.route,plan:candidate.plan});break}
    }
  }
  const hostile=flights.find(f=>f.role==='fighter')!
  for(const sq of squadrons){
    if(sq.aircraft<=0){executionRoutes[sq.id]=sq.route;continue}
    const chosen=plannedInterceptions.get(sq.id);const target=chosen?.target??hostile
    const encounter=closestEncounter(chosen?.route??sq.route,sq.role,target.route,target.role)
    const hostileActive=target.status!=='destroyed'&&target.status!=='disengaging'&&target.status!=='rtb'
    const radarContact=plannedReceipts.get(`${sq.id}:${target.id}`)?.[0]
    if(sq.role==='fighter'&&hostileActive&&sq.aggression==='conservative'&&(radarContact||encounter.distance<=effectiveSensorRange(sq))){
      executionRoutes[sq.id]=routeThroughProgress(sq.route,encounter.friendlyProgress,base);sq.status='rtb';add('info','FIGHTER AVOIDS CONTACT',`${sq.callsign} recovers rather than initiating combat under CONSERVATIVE doctrine.`,encounter.point,encounter.progress*EXECUTION_SECONDS)
    }else if(sq.role==='fighter'&&chosen){
      executionRoutes[sq.id]=chosen.route;interceptPlans.push(chosen.plan)
      if(chosen.plan.outcome==='lost-contact'){sq.status='rtb';add('warning','FIGHTER TRACK LOST',`${sq.callsign} breaks pursuit and recovers after losing the ${chosen.plan.source.toUpperCase()} track.`,routePoint(chosen.route,Math.min(.999,chosen.plan.end/EXECUTION_SECONDS)),chosen.plan.end)}
      else if(hostileActive&&encounter.distance<=FIGHTER_MERGE_RANGE){
        const start=clamp(encounter.progress*EXECUTION_SECONDS,.8,EXECUTION_SECONDS-7.2)
        add('friendly','FIGHTER INTERCEPT',`${sq.callsign} leaves the planned route on a ${chosen.plan.source.toUpperCase()} track.`,encounter.point,chosen.plan.start)
        const result=dogfight(state.round,combatSequences.length,sq,target,encounter.point,start,roll,add)
        roll=result.roll;combatSequences.push(result.sequence);weaponEffects.push(...result.effects)
      }
    }else if(sq.role==='fighter'&&hostileActive&&encounter.distance<=FIGHTER_MERGE_RANGE){
      executionRoutes[sq.id]=routeThroughProgress(sq.route,encounter.friendlyProgress,base)
      const start=clamp(encounter.progress*EXECUTION_SECONDS,.8,EXECUTION_SECONDS-7.2)
      const result=dogfight(state.round,combatSequences.length,sq,target,encounter.point,start,roll,add)
      roll=result.roll;combatSequences.push(result.sequence);weaponEffects.push(...result.effects)
    }else if(sq.role==='recon'&&hostileActive&&encounter.distance<=effectiveSensorRange(sq)*1.15){
      const start=Math.max(3,encounter.progress*EXECUTION_SECONDS)
      const pressesOn=sq.aggression==='aggressive'
      const doctrine=sq.aggression.toUpperCase()
      if(!pressesOn){executionRoutes[sq.id]=routeThroughProgress(sq.route,encounter.friendlyProgress,base);sq.status='disengaging';add('warning','RECON BREAKS CONTACT',`${sq.callsign} aborts collection after fighter contact under ${doctrine} doctrine.`,encounter.point,start)}
      else{const result=reconPursuit(state.round,combatSequences.length,sq,hostile,encounter.point,start,roll,add);roll=result.roll;combatSequences.push(result.sequence);weaponEffects.push(...result.effects);if(sq.status==='destroyed')executionRoutes[sq.id]=routeThroughProgress(sq.route,encounter.friendlyProgress,base)}
    }else executionRoutes[sq.id]=ensureRecovery(sq.route,base)
  }
  for(const sq of squadrons){
    if(sq.aircraft<=0)continue
    for(const asset of assets.filter(a=>a.kind==='sam'||a.kind==='aaa')){
      const result=groundDefenseEngagement({round:state.round,index:combatSequences.length,asset,target:sq,route:executionRoutes[sq.id],friendlyDefense:false,seed:roll,add})
      if(!result)continue
      roll=result.roll;combatSequences.push(result.sequence);weaponEffects.push(...result.effects);asset.hidden=false;asset.confidence=Math.max(asset.confidence,78);asset.intel=levelFor(asset.confidence)
      if(sq.status==='destroyed')break
    }
  }
  for(const flight of flights){
    if(flight.aircraft<=0)continue
    for(const asset of playerAssets.filter(a=>a.kind==='sam'||a.kind==='aaa')){
      const result=groundDefenseEngagement({round:state.round,index:combatSequences.length,asset,target:flight,route:flight.route,friendlyDefense:true,seed:roll,add})
      if(!result)continue
      roll=result.roll;combatSequences.push(result.sequence);weaponEffects.push(...result.effects)
      if(flight.status==='destroyed')break
    }
  }
  for(const flight of flights){
    const radarWindows=radar?sampledDetectionWindows('radar',progress=>aliveAt(flight.id,progress,combatSequences)&&distance(unitPositionAt(flight.route,flight.role,flight.id,progress,combatSequences),radar.position)<=RADAR_RANGE,'GROUND RADAR'):[]
    const visualWindows=squadrons.flatMap(sq=>sampledDetectionWindows('visual',progress=>aliveAt(flight.id,progress,combatSequences)&&aliveAt(sq.id,progress,combatSequences)&&distance(unitPositionAt(flight.route,flight.role,flight.id,progress,combatSequences),unitPositionAt(executionRoutes[sq.id],sq.role,sq.id,progress,combatSequences))<=effectiveSensorRange(sq),sq.callsign))
    flight.detectionWindows=[...radarWindows,...visualWindows].sort((a,b)=>a.start-b.start)
    flight.identityLearnedAt=visualWindows.length?Math.min(...visualWindows.map(window=>window.start)):undefined
    if(radar)for(const squadron of squadrons){
      const receiptWindows=sampledDetectionWindows('radar',progress=>radarWindows.some(window=>progress>=window.start&&progress<=window.end)&&aliveAt(squadron.id,progress,combatSequences)&&distance(unitPositionAt(executionRoutes[squadron.id],squadron.role,squadron.id,progress,combatSequences),radar.position)<=RADAR_COMMUNICATION_RANGE,squadron.callsign)
      receiptWindows.forEach((window,index)=>radarTrackReceipts.push({id:`receipt-${flight.id}-${squadron.id}-${index}`,radarId:radar.id,receiverId:squadron.id,targetId:flight.id,start:window.start*EXECUTION_SECONDS,end:window.end*EXECUTION_SECONDS}))
    }
    for(const [index,window] of radarWindows.entries()){
      const start=window.start*EXECUTION_SECONDS;const position=unitPositionAt(flight.route,flight.role,flight.id,window.start,combatSequences)
      contactObservations.push({id:`track-${flight.id}-${index}`,observerId:'radar',targetId:flight.id,start,end:window.end*EXECUTION_SECONDS,source:'radar',confidence:32,position,recovered:true})
      add('warning','RADAR CONTACT','Ground radar holds an uncertain airborne track.',position,start)
    }
  }
  for(const sq of squadrons){
    if(sq.aircraft<=0)continue
    const route=executionRoutes[sq.id]
    sq.readiness=Math.max(25,sq.readiness-(sq.role==='fighter'?12:7));sq.ammo=Math.max(0,sq.ammo-(sq.role==='fighter'?28:8))
    if(sq.role!=='recon')continue
    const recovered=sq.status!=='destroyed'&&distance(route.at(-1)!,base)<.35
    const observed=assets.filter(asset=>nearRoute(route,asset.position,3.8))
    for(const asset of observed){
      contactObservations.push({id:`ground-${sq.id}-${asset.id}`,observerId:sq.id,targetId:asset.id,start:7,end:16,source:'visual',confidence:90,position:asset.position,recovered})
      intelReports.push({id:`intel-${sq.id}-${asset.id}`,observerId:sq.id,assetId:asset.id,confidence:90,recovered,detail:`${sq.callsign} ${recovered?'recovered':'lost'} observation of ${asset.kind}.`})
      if(recovered){asset.confidence=Math.max(asset.confidence,90);asset.intel=levelFor(asset.confidence);asset.hidden=false;add('friendly','INTEL RECOVERED',`${sq.callsign} returns with confirmed ${asset.kind.toUpperCase()} coordinates.`,asset.position,16)}
      else add('danger','INTEL LOST',`${sq.callsign} saw a fixed signature, but its report did not return.`,asset.position,16)
    }
    if(recovered)mappedAreas.push(...sampleRoute(route))
    if(!observed.length)add('warning','RECON NEGATIVE',`${sq.callsign} finds no fixed signatures on this route.`,undefined,16)
  }
  add('friendly','RECOVERY COMPLETE','Surviving formations are back at base. Review the dogfight and recovered intelligence.',base,21.2);events.sort((a,b)=>a.time-b.time)
  const enemyLosses=flights.reduce((sum,flight)=>sum+flight.initialAircraft-flight.aircraft,0);const friendlyLosses=squadrons.reduce((sum,sq)=>sum+sq.maxAircraft-sq.aircraft,0);const lessons:DoctrineLesson[]=events.filter(event=>['DOGFIGHT ENDS','RECON BREAKS CONTACT','INTEL RECOVERED','INTEL LOST'].includes(event.title)).slice(0,4).map(event=>({title:event.title,detail:event.detail,tone:event.tone==='danger'?'danger':event.tone==='warning'?'warning':'friendly'}));const result:RoundResult={events,squadrons,assets,enemyLosses,friendlyLosses,intelGained:intelReports.filter(report=>report.recovered).map(report=>report.detail),baseDamage:0,enemyBaseDamage:0,logistics:Math.min(15,state.logistics+4),command:Math.min(3,state.command+1),executionRoutes,enemyFlights:flights,defenseCues,defensiveAwareness:0,lessons,playerAssets,reinforcementCalls:[],roundScore:0,baseExposure:state.baseExposure,baseExposureDelta:0,combatSequences,weaponEffects,contactObservations,radarTrackReceipts,interceptPlans,intelReports,mappedAreas};result.roundScore=battleScoreAt(result,Infinity);return result
*/}

export function applyRound(state:MatchState,result:RoundResult):MatchState{return {...state,phase:'debrief',squadrons:result.squadrons,enemyAssets:result.assets,playerAssets:result.playerAssets,lastResult:result,logistics:result.logistics,command:result.command,campaignScore:state.campaignScore+result.roundScore,seed:state.seed+97,mappedAreas:mergeMappedAreas(state.mappedAreas??[],result.mappedAreas),discoveredBoundaries:mergeBoundarySegments(state.discoveredBoundaries??[],result.discoveredBoundaries??[])}}
export function callReinforcement(result:RoundResult,type:ReinforcementType,time:number,base:Point):RoundResult{if(result.reinforcementCalls.some(call=>call.type===type))return result;const next=structuredClone(result);const option=REINFORCEMENT_OPTIONS[type];const target=next.squadrons.find(s=>s.aircraft<s.maxAircraft);if(type==='replacement-flight'&&!target)return result;if(target&&type==='replacement-flight')target.aircraft=Math.min(target.maxAircraft,target.aircraft+1);const call:ReinforcementCall={id:`reserve-${next.reinforcementCalls.length}`,type,time:Math.min(19,time+.5),scoreCost:option.scoreCost,title:type==='alert-cap'?'ALERT FIGHTERS ARRIVE':'REPLACEMENT FLIGHT INBOUND',detail:type==='alert-cap'?'A reserve fighter pair is ready for the next contact.':`One replacement aircraft ferries into ${target!.callsign}.`,route:[base,[-4,5],base],targetSquadronId:target?.id};next.reinforcementCalls.push(call);next.events.push({id:call.id,time:call.time,tone:'friendly',title:call.title,detail:call.detail,position:base});next.events.sort((a,b)=>a.time-b.time);return next}
export function serviceSquadronCost(sq:Squadron){return sq.damaged>0?2:sq.aircraft<sq.maxAircraft?4:0}
export function repairSquadron(state:MatchState,id:string):MatchState{const target=state.squadrons.find(s=>s.id===id);const cost=target?serviceSquadronCost(target):0;if(!target||cost===0||state.logistics<cost)return state;return {...state,logistics:state.logistics-cost,squadrons:state.squadrons.map(s=>s.id!==id?s:s.damaged>0?{...s,damaged:s.damaged-1,readiness:Math.min(100,s.readiness+14)}:{...s,aircraft:Math.min(s.maxAircraft,s.aircraft+1),strength:Math.min(100,strengthOf(s)+25)})}}
export function rearmSquadron(state:MatchState,id:string):MatchState{return state.logistics<1?state:{...state,logistics:state.logistics-1,squadrons:state.squadrons.map(s=>s.id===id?{...s,ammo:100}:s)}}
export function restoreReadiness(state:MatchState,id:string):MatchState{return state.logistics<1?state:{...state,logistics:state.logistics-1,squadrons:state.squadrons.map(s=>s.id===id?{...s,readiness:Math.min(100,s.readiness+16)}:s)}}
export function repairDefense(state:MatchState,id:string):MatchState{return state.logistics<2?state:{...state,logistics:state.logistics-2,playerAssets:state.playerAssets.map(a=>a.id===id?{...a,health:Math.min(100,a.health+28)}:a)}}
export function repairRunway(state:MatchState):MatchState{return state.logistics<3||state.playerBaseHealth===100?state:{...state,logistics:state.logistics-3,playerBaseHealth:Math.min(100,state.playerBaseHealth+18)}}
