import { ENEMY_BASE } from './data'
import type { Asset, CombatEvent, DefenseCue, DetectionWindow, DoctrineLesson, EnemyFlight, IntelLevel, MatchState, Point, RoundResult, Squadron } from './types'

export const SENSOR_RANGE: Record<Squadron['role'], number> = { interceptor:4.2, fighter:3.6, strike:2.1, recon:4.8 }
export const RADAR_RANGE=6.4
const distance=(a:Point,b:Point)=>Math.hypot(a[0]-b[0],a[1]-b[1])
const levelFor=(confidence:number):IntelLevel=>confidence>=90?'confirmed':confidence>=65?'probable':confidence>=25?'suspected':'unknown'
const segmentDistance=(point:Point,a:Point,b:Point)=>{const dx=b[0]-a[0],dy=b[1]-a[1];if(dx===0&&dy===0)return distance(point,a);const t=clamp(((point[0]-a[0])*dx+(point[1]-a[1])*dy)/(dx*dx+dy*dy));return distance(point,[a[0]+t*dx,a[1]+t*dy])}
const routeNear=(route:Point[],point:Point,radius:number)=>route.length===1?distance(route[0],point)<=radius:route.slice(1).some((p,i)=>segmentDistance(point,route[i],p)<=radius)
const rand=(seed:number)=>{const x=Math.sin(seed)*10000;return x-Math.floor(x)}
const clamp=(v:number,min=0,max=1)=>Math.max(min,Math.min(max,v))
const formationStrength=(sq:Squadron)=>sq.maxAircraft===0?0:clamp(sq.aircraft/sq.maxAircraft)
export const effectiveSensorRange=(sq:Squadron)=>SENSOR_RANGE[sq.role]*(.68+.32*formationStrength(sq))
const assetPosition=(assets:Asset[],kind:Asset['kind'],fallback:Point):Point=>assets.find(a=>a.kind===kind)?.position??fallback

function routePoint(route:Point[],progress:number):Point{
  if(route.length<2)return route[0]??[0,0]
  const lengths=route.slice(1).map((p,i)=>distance(route[i],p));const total=lengths.reduce((a,b)=>a+b,0)
  let remaining=clamp(progress)*total
  for(let i=0;i<lengths.length;i++){if(remaining<=lengths[i]){const f=lengths[i]===0?0:remaining/lengths[i];return [route[i][0]+(route[i+1][0]-route[i][0])*f,route[i][1]+(route[i+1][1]-route[i][1])*f]}remaining-=lengths[i]}
  return route.at(-1)!
}

function closestEncounter(friendly:Point[],hostile:Point[]){
  let best={distance:Infinity,point:hostile[0],progress:0}
  for(let i=0;i<=40;i++){const p=routePoint(hostile,i/40);for(const own of friendly){const d=distance(own,p);if(d<best.distance)best={distance:d,point:p,progress:i/40}}}
  return best
}

function makeEnemyFlights(state:MatchState,roll:number):EnemyFlight[]{
  const playerBase=assetPosition(state.playerAssets,'base',[-7.8,11.2]);const playerDecoy=assetPosition(state.playerAssets,'decoy',[6.8,9.2])
  const target:EnemyFlight['target']=rand(roll)<(state.round<3?.72:.38)?'decoy':'base'
  const aimpoint=target==='base'?playerBase:playerDecoy
  return [
    {id:'red-fighter',callsign:'BOGEY 1',role:'fighter',aircraft:4,target,route:[ENEMY_BASE,[5,-6],[1,-1],[-2,3],[1,-1],[5,-6],ENEMY_BASE],detectionWindows:[]},
    {id:'red-strike',callsign:'RAIDER',role:'strike',aircraft:3,target,route:[ENEMY_BASE,[5,-7],[2,-2],aimpoint,[2,-2],[5,-7],ENEMY_BASE],detectionWindows:[]},
  ]
}

function buildExecutionRoute(sq:Squadron,flights:EnemyFlight[],radarCanSee:boolean,add:(tone:CombatEvent['tone'],title:string,detail:string,position?:Point,time?:number)=>void):Point[]{
  const base=[...sq.route] as Point[]
  if(base.length<2)return base
  const hostile=flights[0];const encounter=closestEncounter(base,hostile.route);const sensorRange=effectiveSensorRange(sq);const visual=encounter.distance<=sensorRange
  const canReact=visual||radarCanSee
  if(sq.mission==='CAP'&&canReact){
    if(sq.aggression==='cautious'){
      add('friendly','CONTACT SHADOWED',`${sq.callsign} holds its patrol geometry and passes the track to the defensive network.`,encounter.point,6.2)
      return base
    }
    if(sq.aggression==='balanced'&&encounter.distance>sensorRange*1.12)return base
    const lead=routePoint(hostile.route,clamp(encounter.progress+(sq.aggression==='aggressive'?.12:.04)))
    const insert=Math.max(1,Math.floor(base.length*.55));base.splice(insert,0,encounter.point)
    if(sq.aggression==='aggressive')base.splice(insert+1,0,lead)
    add('friendly','CAP DIVERTS',`${sq.callsign} ${sq.aggression==='aggressive'?'pursues beyond the patrol line':'intercepts inside its assigned sector'}.`,encounter.point,6.6)
  } else if(sq.mission==='ESCORT'&&canReact&&sq.aggression==='aggressive'){
    const insert=Math.max(1,base.length-1);base.splice(insert,0,encounter.point)
    add('warning','ESCORT PEELS OFF',`${sq.callsign} briefly chases the contact, then rejoins the strike package.`,encounter.point,7.1)
  }
  return base
}

function detectionWindows(flight:EnemyFlight,squadrons:Squadron[],routes:Record<string,Point[]>,radar:Asset):DetectionWindow[]{
  const samples:Array<{p:number;source:'radar'|'visual';observer?:string}>=[]
  for(let i=0;i<=60;i++){const p=i/60;const enemy=routePoint(flight.route,p)
    if(radar.health>0&&distance(enemy,radar.position)<=RADAR_RANGE*(.55+.45*radar.health/100)){samples.push({p,source:'radar'});continue}
    const observer=squadrons.find(s=>s.aircraft>0&&s.mission==='CAP'&&distance(enemy,routePoint(routes[s.id]??s.route,p))<=effectiveSensorRange(s))
    if(observer)samples.push({p,source:'visual',observer:observer.callsign})
  }
  const windows:DetectionWindow[]=[]
  for(const sample of samples){const last=windows.at(-1);if(last&&last.source===sample.source&&last.observer===sample.observer&&sample.p-last.end<.04)last.end=Math.min(1,sample.p+.035);else windows.push({start:Math.max(0,sample.p-.02),end:Math.min(1,sample.p+.035),source:sample.source,observer:sample.observer})}
  return windows
}

function buildDefenseCues(flight:EnemyFlight,squadrons:Squadron[],windows:DetectionWindow[]):DefenseCue[]{
  return windows.flatMap((window,index)=>{
    if(window.source!=='visual'||!window.observer)return []
    const observer=squadrons.find(s=>s.callsign===window.observer)
    if(!observer||observer.mission!=='CAP')return []
    if(observer.aggression==='aggressive'&&observer.risk!=='preserve')return []
    const discipline=observer.aggression==='cautious'?.26:observer.aggression==='balanced'?.11:-.08
    const preservation=observer.risk==='preserve'?.16:observer.risk==='normal'?.05:-.04
    const strength=clamp(.18+discipline+preservation+(observer.readiness/100)*.18+formationStrength(observer)*.14,.12,.88)
    return [{id:`cue-${flight.id}-${index}`,flightId:flight.id,start:window.start,end:Math.min(1,window.end+.1+strength*.08),observer:observer.callsign,strength,rangeBonus:.6+strength*1.8,damageReduction:.12+strength*.4}]
  })
}

function addNetworkTracking(flight:EnemyFlight,cues:DefenseCue[]){
  for(const cue of cues){
    const directEnd=flight.detectionWindows.filter(w=>w.observer===cue.observer&&w.end<=cue.end).at(-1)?.end??cue.start
    if(cue.end>directEnd+.02)flight.detectionWindows.push({start:directEnd,end:cue.end,source:'network',observer:cue.observer})
  }
  flight.detectionWindows.sort((a,b)=>a.start-b.start)
}

function deriveLessons(events:CombatEvent[],flights:EnemyFlight[]):DoctrineLesson[]{
  const lessons:DoctrineLesson[]=[];const add=(title:string,detail:string,tone:DoctrineLesson['tone'])=>{if(!lessons.some(x=>x.title===title))lessons.push({title,detail,tone})}
  for(const event of events){
    if(event.title==='CONTACT SHADOWED')add('Conservative CAP strengthened the network',`${event.detail} Holding station preserved coverage instead of chasing the first contact.`,'friendly')
    if(event.title==='CAP DIVERTS')add('Aggression changed the flown route',`${event.detail} The pursuit created an opening behind the patrol.`,'warning')
    if(event.title==='ABORT THRESHOLD')add('Preserve Force caused an abort',event.detail,'warning')
    if(event.title==='TRACKED BY FIRE CONTROL')add('Risk posture accepted defensive exposure',event.detail,'danger')
    if(event.title==='AIRCRAFT LOST'||event.title==='PURSUIT LOSS')add('Attrition carries into the next round',`${event.detail} The smaller formation now has reduced sensor and combat power.`,'danger')
  }
  if(flights.some(f=>f.detectionWindows.some(w=>w.end<.92)))add('A contact disappeared when observation ended','The route history shows only detected portions of the hostile track; movement outside radar, visual, or shared-network coverage remains hidden.','warning')
  return lessons.slice(0,4)
}

export function resolveRound(state:MatchState):RoundResult{
  const squadrons:Squadron[]=structuredClone(state.squadrons);const assets:Asset[]=structuredClone(state.enemyAssets);const playerAssets:Asset[]=structuredClone(state.playerAssets)
  const playerBase=assetPosition(playerAssets,'base',[-7.8,11.2]);const radar=playerAssets.find(a=>a.kind==='radar')??{id:'fallback-radar',kind:'radar',position:[-6.7,5.8] as Point,intel:'confirmed' as const,confidence:100,health:0,hidden:false}
  const events:CombatEvent[]=[];const intelGained:string[]=[];let enemyLosses=0,friendlyLosses=0,enemyBaseDamage=0,baseDamage=0,cursor=2,roll=state.seed+state.round*31
  const add=(tone:CombatEvent['tone'],title:string,detail:string,position?:Point,time?:number)=>{events.push({id:`${state.round}-${events.length}`,time:time??cursor,tone,title,detail,position});if(time===undefined)cursor+=1.65}
  add('info','SORTIES AIRBORNE',`${squadrons.reduce((n,s)=>n+s.aircraft,0)} aircraft committed. Doctrine control is now autonomous.`,undefined,.8)
  const enemyFlights=makeEnemyFlights(state,roll++)
  const radarCanSee=radar.health>0&&enemyFlights.some(f=>Array.from({length:31},(_,i)=>routePoint(f.route,i/30)).some(p=>distance(p,radar.position)<=RADAR_RANGE*(.55+.45*radar.health/100)))
  const executionRoutes:Record<string,Point[]>={}
  for(const sq of squadrons)executionRoutes[sq.id]=sq.aircraft>0?buildExecutionRoute(sq,enemyFlights,radarCanSee,add):sq.route
  const defenseCues:DefenseCue[]=[]
  for(const flight of enemyFlights){
    flight.detectionWindows=detectionWindows(flight,squadrons,executionRoutes,radar)
    const cues=buildDefenseCues(flight,squadrons,flight.detectionWindows);defenseCues.push(...cues);addNetworkTracking(flight,cues)
    const first=flight.detectionWindows[0]
    if(first)add(first.source==='radar'?'warning':'friendly',first.source==='radar'?'RADAR CONTACT':'VISUAL CONTACT',first.source==='radar'?`Unknown aircraft enter the early-warning envelope. Track quality is intermittent.`:`${first.observer} identifies ${flight.aircraft} hostile aircraft.`,routePoint(flight.route,first.start),Math.max(1.4,first.start*18))
  }
  const strongestCue=defenseCues.reduce<DefenseCue|undefined>((best,cue)=>!best||cue.strength>best.strength?cue:best,undefined)
  if(strongestCue)add('friendly','DEFENSE NETWORK CUED',`${strongestCue.observer} shares a stable track. Radar and local defenses gain ${strongestCue.rangeBonus.toFixed(1)} range and faster reaction.`,routePoint(enemyFlights.find(f=>f.id===strongestCue.flightId)!.route,strongestCue.start),Math.max(2,strongestCue.start*18+.5))

  for(const sq of squadrons){
    if(sq.aircraft<=0){add('danger','SQUADRON GROUNDED',`${sq.callsign} has no serviceable aircraft and cannot launch.`);continue}
    const route=executionRoutes[sq.id];const readinessFactor=sq.readiness/100;const startingAmmo=sq.ammo
    sq.readiness=Math.max(20,sq.readiness-(sq.risk==='press'?16:sq.risk==='normal'?11:7));sq.ammo=Math.max(0,sq.ammo-(sq.mission==='STRIKE'?45:25))
    const threat=assets.filter(a=>(a.kind==='sam'||a.kind==='aaa')&&a.health>0).find(a=>routeNear(route,a.position,a.kind==='sam'?3.2:1.9))
    let effectiveRoute=route
    if(threat&&sq.risk==='preserve'){
      const stop=Math.max(2,route.findIndex(p=>distance(p,threat.position)<(threat.kind==='sam'?3.2:1.9)));effectiveRoute=route.slice(0,stop);effectiveRoute.push(playerBase);executionRoutes[sq.id]=effectiveRoute
      add('warning','ABORT THRESHOLD',`${sq.callsign} detects a threat and turns home under Preserve Force doctrine.`,threat.position)
    } else if(threat){
      add('danger','TRACKED BY FIRE CONTROL',`${sq.callsign} ${sq.risk==='press'?'presses through':'crosses'} an active ${threat.kind.toUpperCase()} envelope.`,threat.position)
      const lossChance=(sq.risk==='press'?.5:.3)*(1.15-readinessFactor)
      if(rand(roll++)<lossChance&&sq.aircraft>0){sq.aircraft--;friendlyLosses++;sq.readiness=Math.max(15,sq.readiness-12);add('danger','AIRCRAFT LOST',`${sq.callsign} loses one aircraft before exiting the threat ring. Replacement will cost 4 logistics.`)}else if(rand(roll++)<.48){sq.damaged++;sq.readiness=Math.max(15,sq.readiness-8);add('warning','DAMAGE REPORTED',`${sq.callsign} is hit but ${sq.risk==='press'?'continues toward the objective':'disengages'}.`)}
    }
    const nearby=assets.filter(a=>routeNear(effectiveRoute,a.position,sq.role==='recon'?3.8:2.1))
    if(sq.role==='recon'){for(const a of nearby){const old=a.intel;const gain=32+(sq.risk==='press'?16:0);a.confidence=Math.min(100,a.confidence+gain);a.intel=levelFor(a.confidence);a.hidden=false;if(old!==a.intel){const label=a.kind==='base'?'AIRFIELD':a.kind.toUpperCase();intelGained.push(`${label} ${a.intel.toUpperCase()} · ${a.confidence}%`);add('friendly','INTEL UPDATED',`${sq.callsign} resolves a ${label.toLowerCase()} signature to ${a.intel} confidence.`,a.position)}}if(!nearby.length)add('warning','RECON NEGATIVE',`${sq.callsign} finds no fixed signatures in its observation footprint.`)}
    if(sq.mission==='CAP'){
      const encounter=closestEncounter(effectiveRoute,enemyFlights[0].route);const sensorRange=effectiveSensorRange(sq);const engageRange=sq.aggression==='aggressive'?sensorRange*1.7:sq.aggression==='balanced'?sensorRange:sensorRange*.45
      if(encounter.distance<=engageRange){
        const riskBonus=sq.risk==='press'?.14:sq.risk==='preserve'?-.06:0;const killChance=clamp(.28+readinessFactor*.24+formationStrength(sq)*.2+riskBonus,.12,.82);const kill=rand(roll++)<killChance
        enemyLosses+=kill?1:0;enemyFlights[0].aircraft=Math.max(0,enemyFlights[0].aircraft-(kill?1:0));add(kill?'friendly':'warning',kill?'INTERCEPT SUCCESS':'CONTACT BREAKS',kill?`${sq.callsign} destroys one hostile after a ${sq.aggression} pursuit.`:`${sq.callsign} reaches its doctrine limit and returns to patrol.`,encounter.point)
        const diverted=sq.aggression==='aggressive'&&route.length>sq.route.length
        if(diverted){
          sq.readiness=Math.max(10,sq.readiness-9);sq.ammo=Math.max(0,sq.ammo-15)
          add('warning','PATROL SECTOR OPEN',`${sq.callsign} is displaced from station; the defensive network temporarily loses coverage behind the pursuit.`,route[Math.min(route.length-1,Math.floor(route.length*.65))])
          const posture=sq.risk==='press'?1.45:sq.risk==='normal'?1:.55;const exposure=(kill?.72:1.18)*posture*(1.2-readinessFactor)
          if(rand(roll++)<.3*exposure&&sq.aircraft>0){sq.aircraft--;friendlyLosses++;sq.readiness=Math.max(10,sq.readiness-16);add('danger','PURSUIT LOSS',`${sq.callsign} loses an aircraft beyond mutual support. Replacement will cost 4 logistics.`,encounter.point)}else if(rand(roll++)<.34*posture){sq.damaged++;sq.readiness=Math.max(10,sq.readiness-10);add('warning','OVEREXTENSION DAMAGE',`${sq.callsign} returns with a damaged aircraft after the deep pursuit.`,encounter.point)}
        }
      }
    }
    if(sq.role==='strike'&&startingAmmo>=35){const target=assets.filter(a=>a.health>0&&routeNear(effectiveRoute,a.position,2.4)).sort((a,b)=>distance(effectiveRoute.at(-1)!,a.position)-distance(effectiveRoute.at(-1)!,b.position))[0];if(target){const escort=squadrons.some(s=>s.role==='fighter'&&s.mission==='ESCORT'&&s.aircraft>1);const dmg=Math.round((22+rand(roll++)*20)*(escort?1.2:.82)*(sq.risk==='press'?1.25:.85)*(.45+.55*formationStrength(sq)));target.health=Math.max(0,target.health-dmg);if(target.kind==='base')enemyBaseDamage=Math.min(state.enemyBaseHealth,dmg);target.hidden=false;target.confidence=Math.max(target.confidence,75);target.intel=levelFor(target.confidence);add('friendly','WEAPONS IMPACT',`${sq.callsign} reports ${dmg}% damage on a ${target.intel==='confirmed'?'confirmed':'possible'} ${target.kind}.`,target.position);if(target.health===0)add('friendly','TARGET DESTROYED',`Enemy ${target.kind} is out of action.`,target.position)}else add('warning','NO VALID TARGET',`${sq.callsign} releases no weapons; its autonomous route never reaches an aimpoint.`)}else if(sq.role==='strike')add('warning','PACKAGE NOT ARMED',`${sq.callsign} cannot strike with ${startingAmmo}% ordnance. Rearm before committing.`)
  }

  const raider=enemyFlights.find(f=>f.role==='strike')!
  const raidCue=defenseCues.filter(c=>c.flightId===raider.id).reduce<DefenseCue|undefined>((best,cue)=>!best||cue.strength>best.strength?cue:best,undefined)
  if(raider.target==='base'){
    const coveringDefenses=playerAssets.filter(a=>(a.kind==='sam'||a.kind==='aaa')&&a.health>0&&routeNear(raider.route,a.position,(a.kind==='sam'?3.2:1.9)+(raidCue?.rangeBonus??0)))
    for(const defense of coveringDefenses){const shotChance=(defense.kind==='sam'?.2:.1)+(defense.health/100)*.12+(raidCue?.strength??0)*.34;if(rand(roll++)<shotChance&&raider.aircraft>0){raider.aircraft--;enemyLosses++;add('friendly','LAYERED DEFENSE ENGAGES',`${defense.kind.toUpperCase()} ${raidCue?`uses ${raidCue.observer}'s shared track`:'acquires locally'} and destroys one raider before weapons release.`,defense.position,12.5)}}
    const rawDamage=10+rand(roll++)*17;const formationPenalty=raider.aircraft/3;baseDamage=Math.max(0,Math.round(rawDamage*formationPenalty*(1-(raidCue?.damageReduction??0))))
    if(baseDamage>0){add('danger','HOME BASE STRUCK',`Observed impacts damage the runway complex by ${baseDamage}%${raidCue?' after the cued defense disrupts the attack':''}.`,playerBase,14.2);const collateral=playerAssets.filter(a=>a.kind==='radar'||a.kind==='sam'||a.kind==='aaa').sort((a,b)=>distance(a.position,playerBase)-distance(b.position,playerBase))[0];if(collateral&&rand(roll++)<.45){const damage=Math.round(10+rand(roll++)*16);collateral.health=Math.max(0,collateral.health-damage);add('danger','DEFENSE SITE DAMAGED',`${collateral.kind.toUpperCase()} takes ${damage}% collateral damage and will need logistics to restore.`,collateral.position,15)}}else add('friendly','RAID DEFEATED',`The layered defensive network breaks up the attack before it can damage the base.`,playerBase,14.2)
  }
  if(enemyBaseDamage>0)intelGained.push(`Enemy airbase damaged · ${Math.max(0,state.enemyBaseHealth-enemyBaseDamage)}% integrity`)
  events.sort((a,b)=>a.time-b.time)
  const lessons=deriveLessons(events,enemyFlights)
  return {events,squadrons,assets,enemyLosses,friendlyLosses,intelGained,baseDamage,enemyBaseDamage,logistics:Math.min(15,state.logistics+5),command:Math.min(3,state.command+1),executionRoutes,enemyFlights,defenseCues,defensiveAwareness:Math.round((strongestCue?.strength??0)*100),lessons,playerAssets}
}

export function applyRound(state:MatchState,result:RoundResult):MatchState{const enemyBaseHealth=Math.max(0,state.enemyBaseHealth-result.enemyBaseDamage);const playerBaseHealth=Math.max(0,state.playerBaseHealth-result.baseDamage);return {...state,phase:enemyBaseHealth<=0?'victory':playerBaseHealth<=0?'defeat':'debrief',squadrons:result.squadrons,enemyAssets:result.assets,playerAssets:result.playerAssets,enemyBaseHealth,playerBaseHealth,logistics:result.logistics,command:result.command,lastResult:result,seed:state.seed+97}}
export function serviceSquadronCost(sq:Squadron){return sq.damaged>0?2:sq.aircraft<sq.maxAircraft?4:0}
export function repairSquadron(state:MatchState,id:string):MatchState{const target=state.squadrons.find(s=>s.id===id);if(!target)return state;const cost=serviceSquadronCost(target);const replacing=target.damaged===0&&target.aircraft<target.maxAircraft;if(cost===0||state.logistics<cost||replacing&&state.replacements<1)return state;return {...state,logistics:state.logistics-cost,replacements:state.replacements-(replacing?1:0),squadrons:state.squadrons.map(s=>s.id!==id?s:s.damaged>0?{...s,damaged:s.damaged-1,readiness:Math.min(100,s.readiness+14)}:{...s,aircraft:Math.min(s.maxAircraft,s.aircraft+1),readiness:Math.min(100,s.readiness+6)})}}
export function rearmSquadron(state:MatchState,id:string):MatchState{if(state.logistics<1)return state;return {...state,logistics:state.logistics-1,squadrons:state.squadrons.map(s=>s.id===id?{...s,ammo:Math.min(100,s.ammo+50)}:s)}}
export function restoreReadiness(state:MatchState,id:string):MatchState{if(state.logistics<1)return state;return {...state,logistics:state.logistics-1,squadrons:state.squadrons.map(s=>s.id===id?{...s,readiness:Math.min(100,s.readiness+16)}:s)}}
export function repairDefense(state:MatchState,id:string):MatchState{if(state.logistics<2)return state;return {...state,logistics:state.logistics-2,playerAssets:state.playerAssets.map(a=>a.id===id?{...a,health:Math.min(100,a.health+28)}:a)}}
export function repairRunway(state:MatchState):MatchState{if(state.logistics<3||state.playerBaseHealth>=100)return state;return {...state,logistics:state.logistics-3,playerBaseHealth:Math.min(100,state.playerBaseHealth+18)}}
