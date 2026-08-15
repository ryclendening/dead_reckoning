import { ENEMY_BASE } from './data'
import type { Asset, CombatEvent, CombatExchange, CombatSequence, ContactObservation, DefenseCue, DetectionWindow, DoctrineLesson, EnemyFlight, IntelLevel, IntelReport, MatchState, Point, ReinforcementCall, ReinforcementType, RoundResult, Squadron, WeaponEffect, WeaponKind } from './types'

export const SENSOR_RANGE: Record<Squadron['role'], number>={fighter:4.2,recon:4.9}
export const RADAR_RANGE=6.4
export const EXECUTION_SECONDS=22
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
export const effectiveSensorRange=(sq:Squadron)=>SENSOR_RANGE[sq.role]*(.68+.32*clamp(strengthOf(sq)/100))
const ensureRecovery=(route:Point[],base:Point)=>route.length>1&&distance(route.at(-1)!,base)<.35?route:[...route,base]

function routePoint(route:Point[],progress:number):Point{
  if(route.length<2)return route[0]??[0,0]
  const lengths=route.slice(1).map((point,index)=>distance(route[index],point));const total=lengths.reduce((sum,n)=>sum+n,0)
  let remaining=clamp(progress)*total
  for(let i=0;i<lengths.length;i++){if(remaining<=lengths[i]){const f=lengths[i]===0?0:remaining/lengths[i];return [route[i][0]+(route[i+1][0]-route[i][0])*f,route[i][1]+(route[i+1][1]-route[i][1])*f]}remaining-=lengths[i]}
  return route.at(-1)!
}
function closestEncounter(first:Point[],second:Point[]){let best={distance:Infinity,point:second[0]??[0,0] as Point,progress:0};for(let i=0;i<=60;i++){const progress=i/60;const point=routePoint(second,progress);const d=distance(routePoint(first,progress),point);if(d<best.distance)best={distance:d,point,progress}}return best}
function closestRouteProgress(route:Point[],point:Point){let best={distance:Infinity,progress:0,point:route[0]??[0,0] as Point};for(let i=0;i<=80;i++){const progress=i/80;const sample=routePoint(route,progress);const d=distance(sample,point);if(d<best.distance)best={distance:d,progress,point:sample}}return best}
function nearRoute(route:Point[],point:Point,radius:number){for(let i=1;i<route.length;i++){const a=route[i-1],b=route[i];const dx=b[0]-a[0],dy=b[1]-a[1];const t=clamp(((point[0]-a[0])*dx+(point[1]-a[1])*dy)/Math.max(.001,dx*dx+dy*dy));if(distance(point,[a[0]+dx*t,a[1]+dy*t])<=radius)return true}return false}
function playerBase(state:MatchState):Point{return state.playerAssets.find(a=>a.kind==='base')?.position??[-7.8,11.2]}
function enemyFlights():EnemyFlight[]{return [
  {id:'red-fighter',callsign:'BOGEY 1',role:'fighter',aircraft:4,initialAircraft:4,strength:100,morale:74,status:'enroute',target:'decoy',route:[ENEMY_BASE,[5,-6],[.4,-.5],[-3,3],[.4,-.5],[5,-6],ENEMY_BASE],detectionWindows:[]},
  {id:'red-recon',callsign:'SPECTER',role:'recon',aircraft:2,initialAircraft:2,strength:100,morale:70,status:'enroute',target:'base',route:[ENEMY_BASE,[4,-5],[1,.5],[-2.4,4.2],[1,.5],[4,-5],ENEMY_BASE],detectionWindows:[]},
]}
function damage(unit:{strength?:number;morale?:number;aircraft:number;maxAircraft?:number;initialAircraft?:number},amount:number){const before=unit.aircraft;const max=unit.maxAircraft??unit.initialAircraft??before;unit.strength=Math.max(0,strengthOf(unit)-amount);unit.aircraft=aircraftFor(unit.strength,max);unit.morale=Math.max(0,(unit.morale??70)-8-(unit.aircraft<before?18:0));return {before,after:unit.aircraft,strength:unit.strength,morale:unit.morale}}
function weapon(id:string,kind:WeaponKind,sourceId:string,targetId:string,time:number,from:Point,to:Point,hit:boolean,amount:number):WeaponEffect{const travel=kind==='gun'||kind==='aaa' ? .34 : kind==='sam' ? 1.05 : .62;return {id,kind,sourceId,targetId,start:time,end:time+travel,from,to,hit,damage:amount}}

function dogfight(round:number,index:number,friendly:Squadron,hostile:EnemyFlight,location:Point,start:number,seed:number,add:(tone:CombatEvent['tone'],title:string,detail:string,position?:Point,time?:number)=>void){
  const exchanges:CombatExchange[]=[];const effects:WeaponEffect[]=[];let roll=seed;const friendlyBreak=friendly.risk==='preserve'?55:friendly.risk==='normal'?35:15
  add('danger','DOGFIGHT MERGED',`${friendly.callsign} and ${hostile.callsign} stay engaged until one formation is destroyed or breaks contact.`,location,start)
  let i=0
  while(strengthOf(friendly)>0&&strengthOf(hostile)>0&&(friendly.morale??70)>=friendlyBreak&&(hostile.morale??70)>=28&&i<32){
    if(strengthOf(friendly)<=0||strengthOf(hostile)<=0||(friendly.morale??70)<friendlyBreak||(hostile.morale??70)<28)break
    const friendlyAttacks=rand(roll++)<.54+(friendly.readiness-80)/180;const attacker=friendlyAttacks?friendly:hostile;const defender=friendlyAttacks?hostile:friendly;const kind:WeaponKind=rand(roll++)<.45?'air-to-air-missile':'gun';const hit=rand(roll++)<.72;const amount=hit?(kind==='gun'?Math.round(12+rand(roll++)*7):Math.round(26+rand(roll++)*12)):0;const applied=hit?damage(defender,amount):{before:defender.aircraft,after:defender.aircraft,strength:strengthOf(defender),morale:defender.morale??70};const time=start+.42+i*.58
    exchanges.push({id:`fight-${round}-${index}-${i}`,time,attackerId:attacker.id,defenderId:defender.id,weapon:kind,damage:amount,moraleDamage:hit?8:0,hit,position:location,targetStrength:applied.strength,targetMorale:applied.morale})
    effects.push(weapon(`weapon-fight-${round}-${index}-${i}`,kind,attacker.id,defender.id,time-.16,[location[0]+(friendlyAttacks ? -.55 : .55),location[1]+.2],[location[0]+(friendlyAttacks ? .5 : -.5),location[1]-.2],hit,amount))
    if(hit&&applied.after<applied.before)add(friendlyAttacks?'friendly':'danger',friendlyAttacks?'ENEMY AIRCRAFT LOST':'AIRCRAFT LOST',friendlyAttacks?`${hostile.callsign} loses an aircraft.`:`${friendly.callsign} loses an aircraft.`,location,time+.18)
    else if(hit)add(friendlyAttacks?'friendly':'warning','DAMAGE REPORTED',`${defender.callsign} takes ${amount}% formation damage.`,location,time+.18)
    i++
  }
  if(strengthOf(friendly)>0&&strengthOf(hostile)>0&&(friendly.morale??70)>=friendlyBreak&&(hostile.morale??70)>=28){
    const weaker=strengthOf(friendly)<=strengthOf(hostile)?friendly:hostile
    weaker.morale=weaker===friendly?friendlyBreak-1:27
  }
  friendly.status=strengthOf(friendly)<=0?'destroyed':(friendly.morale??70)<friendlyBreak?'disengaging':'rtb';hostile.status=strengthOf(hostile)<=0?'destroyed':(hostile.morale??70)<28?'disengaging':'rtb'
  const reason=friendly.status==='destroyed'?`${friendly.callsign} destroyed`:hostile.status==='destroyed'?`${hostile.callsign} destroyed`:friendly.status==='disengaging'?`${friendly.callsign} breaks contact: morale ${friendly.morale}%`:hostile.status==='disengaging'?`${hostile.callsign} breaks contact: morale ${hostile.morale}%`:'both formations disengage after the sustained exchange'
  add(hostile.status==='destroyed'||hostile.status==='disengaging'?'friendly':'warning','DOGFIGHT ENDS',reason,location,start+Math.max(3.8,exchanges.length*.58+.7))
  return {sequence:{id:`dogfight-${round}-${index}`,kind:'dogfight' as const,participantIds:[friendly.id,hostile.id],location,start,end:start+Math.min(7,Math.max(4.2,exchanges.length*.58+1)),exchanges,finalDisposition:{[friendly.id]:friendly.status,[hostile.id]:hostile.status},moraleBreakReason:reason},effects,roll}
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
  add('warning','RECON PRESSES ON',`${recon.callsign} accepts fighter pursuit and continues the collection route under ${recon.risk.toUpperCase()} doctrine.`,location,start)
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

export function resolveRound(state:MatchState):RoundResult{
  const base=playerBase(state);const squadrons:Squadron[]=structuredClone(state.squadrons).map(s=>({...s,strength:strengthOf(s),morale:s.morale??70,status:'enroute'}));const assets=structuredClone(state.enemyAssets);const playerAssets=structuredClone(state.playerAssets);const flights=enemyFlights();const events:CombatEvent[]=[];const add=(tone:CombatEvent['tone'],title:string,detail:string,position?:Point,time=2)=>events.push({id:`${state.round}-${events.length}`,tone,title,detail,position,time});const executionRoutes:Record<string,Point[]>={};const combatSequences:CombatSequence[]=[];const weaponEffects:WeaponEffect[]=[];const contactObservations:ContactObservation[]=[];const intelReports:IntelReport[]=[];const defenseCues:DefenseCue[]=[];let roll=state.seed+state.round*31
  add('info','SORTIES AIRBORNE',`${squadrons.reduce((total,s)=>total+s.aircraft,0)} aircraft committed: fighters protect, recon observes.`,undefined,.8)
  for(const sq of squadrons)executionRoutes[sq.id]=ensureRecovery(sq.route,base)
  for(const flight of flights){
    const radar=playerAssets.find(a=>a.kind==='radar')
    if(!radar||radar.health<=0)continue
    flight.detectionWindows=[{start:.2,end:.62,source:'radar'}]
    contactObservations.push({id:`track-${flight.id}`,observerId:'radar',targetId:flight.id,start:4.4,end:13.6,source:'radar',confidence:32,position:routePoint(flight.route,.4),recovered:true})
    add('warning','RADAR CONTACT',`Radar holds an uncertain track on ${flight.callsign}.`,routePoint(flight.route,.2),4.3)
  }
  const hostile=flights.find(f=>f.role==='fighter')!
  for(const sq of squadrons){
    if(sq.aircraft<=0){executionRoutes[sq.id]=sq.route;continue}
    const encounter=closestEncounter(sq.route,hostile.route)
    const hostileActive=hostile.status!=='destroyed'&&hostile.status!=='disengaging'&&hostile.status!=='rtb'
    if(sq.role==='fighter'&&hostileActive&&encounter.distance<=effectiveSensorRange(sq)*1.35){
      executionRoutes[sq.id]=[sq.route[0],encounter.point,base]
      const start=clamp(encounter.progress*EXECUTION_SECONDS,3,13)
      const result=dogfight(state.round,combatSequences.length,sq,hostile,encounter.point,start,roll,add)
      roll=result.roll;combatSequences.push(result.sequence);weaponEffects.push(...result.effects)
      hostile.detectionWindows.push({start:Math.max(0,start/EXECUTION_SECONDS-.04),end:Math.min(1,result.sequence.end/EXECUTION_SECONDS+.04),source:'visual',observer:sq.callsign})
    }else if(sq.role==='recon'&&hostileActive&&encounter.distance<=effectiveSensorRange(sq)*1.15){
      const start=Math.max(3,encounter.progress*EXECUTION_SECONDS)
      const pressesOn=sq.aggression==='aggressive'||sq.risk==='press'
      if(!pressesOn){executionRoutes[sq.id]=[sq.route[0],encounter.point,base];sq.status='disengaging';add('warning','RECON BREAKS CONTACT',`${sq.callsign} aborts collection after fighter contact under ${sq.risk.toUpperCase()} doctrine.`,encounter.point,start)}
      else{const result=reconPursuit(state.round,combatSequences.length,sq,hostile,encounter.point,start,roll,add);roll=result.roll;combatSequences.push(result.sequence);weaponEffects.push(...result.effects);if(sq.status==='destroyed')executionRoutes[sq.id]=[sq.route[0],encounter.point]}
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
    if(!observed.length)add('warning','RECON NEGATIVE',`${sq.callsign} finds no fixed signatures on this route.`,undefined,16)
  }
  add('friendly','RECOVERY COMPLETE','Surviving formations are back at base. Review the dogfight and recovered intelligence.',base,21.2);events.sort((a,b)=>a.time-b.time)
  const enemyLosses=flights.reduce((sum,flight)=>sum+flight.initialAircraft-flight.aircraft,0);const friendlyLosses=squadrons.reduce((sum,sq)=>sum+sq.maxAircraft-sq.aircraft,0);const lessons:DoctrineLesson[]=events.filter(event=>['DOGFIGHT ENDS','RECON BREAKS CONTACT','INTEL RECOVERED','INTEL LOST'].includes(event.title)).slice(0,4).map(event=>({title:event.title,detail:event.detail,tone:event.tone==='danger'?'danger':event.tone==='warning'?'warning':'friendly'}));const result:RoundResult={events,squadrons,assets,enemyLosses,friendlyLosses,intelGained:intelReports.filter(report=>report.recovered).map(report=>report.detail),baseDamage:0,enemyBaseDamage:0,logistics:Math.min(15,state.logistics+4),command:Math.min(3,state.command+1),executionRoutes,enemyFlights:flights,defenseCues,defensiveAwareness:0,lessons,playerAssets,reinforcementCalls:[],roundScore:0,baseExposure:state.baseExposure,baseExposureDelta:0,combatSequences,weaponEffects,contactObservations,intelReports};result.roundScore=battleScoreAt(result,Infinity);return result
}

export function applyRound(state:MatchState,result:RoundResult):MatchState{return {...state,phase:'debrief',squadrons:result.squadrons,enemyAssets:result.assets,playerAssets:result.playerAssets,lastResult:result,logistics:result.logistics,command:result.command,campaignScore:state.campaignScore+result.roundScore,seed:state.seed+97}}
export function callReinforcement(result:RoundResult,type:ReinforcementType,time:number,base:Point):RoundResult{if(result.reinforcementCalls.some(call=>call.type===type))return result;const next=structuredClone(result);const option=REINFORCEMENT_OPTIONS[type];const target=next.squadrons.find(s=>s.aircraft<s.maxAircraft);if(type==='replacement-flight'&&!target)return result;if(target&&type==='replacement-flight')target.aircraft=Math.min(target.maxAircraft,target.aircraft+1);const call:ReinforcementCall={id:`reserve-${next.reinforcementCalls.length}`,type,time:Math.min(19,time+.5),scoreCost:option.scoreCost,title:type==='alert-cap'?'ALERT FIGHTERS ARRIVE':'REPLACEMENT FLIGHT INBOUND',detail:type==='alert-cap'?'A reserve fighter pair is ready for the next contact.':`One replacement aircraft ferries into ${target!.callsign}.`,route:[base,[-4,5],base],targetSquadronId:target?.id};next.reinforcementCalls.push(call);next.events.push({id:call.id,time:call.time,tone:'friendly',title:call.title,detail:call.detail,position:base});next.events.sort((a,b)=>a.time-b.time);return next}
export function serviceSquadronCost(sq:Squadron){return sq.damaged>0?2:sq.aircraft<sq.maxAircraft?4:0}
export function repairSquadron(state:MatchState,id:string):MatchState{const target=state.squadrons.find(s=>s.id===id);const cost=target?serviceSquadronCost(target):0;if(!target||cost===0||state.logistics<cost)return state;return {...state,logistics:state.logistics-cost,squadrons:state.squadrons.map(s=>s.id!==id?s:s.damaged>0?{...s,damaged:s.damaged-1,readiness:Math.min(100,s.readiness+14)}:{...s,aircraft:Math.min(s.maxAircraft,s.aircraft+1),strength:Math.min(100,strengthOf(s)+25)})}}
export function rearmSquadron(state:MatchState,id:string):MatchState{return state.logistics<1?state:{...state,logistics:state.logistics-1,squadrons:state.squadrons.map(s=>s.id===id?{...s,ammo:100}:s)}}
export function restoreReadiness(state:MatchState,id:string):MatchState{return state.logistics<1?state:{...state,logistics:state.logistics-1,squadrons:state.squadrons.map(s=>s.id===id?{...s,readiness:Math.min(100,s.readiness+16)}:s)}}
export function repairDefense(state:MatchState,id:string):MatchState{return state.logistics<2?state:{...state,logistics:state.logistics-2,playerAssets:state.playerAssets.map(a=>a.id===id?{...a,health:Math.min(100,a.health+28)}:a)}}
export function repairRunway(state:MatchState):MatchState{return state.logistics<3||state.playerBaseHealth===100?state:{...state,logistics:state.logistics-3,playerBaseHealth:Math.min(100,state.playerBaseHealth+18)}}
