import { BASE_STRIKE_RANGE } from '../../src/game/campaign'
import { generateRouteTemplate, validateGroundStrikeOrder } from '../../src/game/routeTemplates'
import { contactTracksAt } from '../../src/game/contactTracks'
import { createRoundSimulation, FIXED_ASSET_OBSERVATION_RANGE } from '../../src/game/engine'
import { deriveRecoveryPlanningView, formationField } from '../../src/game/forwardBasing'
import { MAX_FLIGHT_DISTANCE, routeDistance } from '../../src/game/flightRules'
import type { Asset, MatchState, Point, RoundResult, SimulationCommand, Squadron } from '../../src/game/types'

export type PlayerPolicy='direct-rush'|'flank'|'recon-strike'|'heavy-sam'|'forward-fob'|'recon-denial'
type Order=(s:MatchState,f:Squadron,mission:Squadron['mission'],station:Point,flank?:boolean,target?:Asset)=>Squadron
const distance=(a:Point,b:Point)=>Math.hypot(a[0]-b[0],a[1]-b[1])
export function scriptedOrder(s:MatchState,f:Squadron,mission:Squadron['mission'],station:Point,flank=false,target?:Asset):Squadron {
  const field=formationField(s.playerAssets,f.id)!,from=field.position,l=Math.max(.01,distance(from,station))
  const midpoint:Point=[(from[0]+station[0])/2-(station[1]-from[1])/l*5,(from[1]+station[1])/2+(station[0]-from[0])/l*5]
  const ingress=flank?[from,midpoint,station]:[from,station]
  const generated=mission==='base-strike'||mission==='transit'?ingress:generateRouteTemplate({template:mission,ingress,maxDistance:MAX_FLIGHT_DISTANCE[f.role],bounds:{minX:Math.min(from[0],station[0])-8,maxX:Math.max(from[0],station[0])+8,minZ:Math.min(from[1],station[1])-8,maxZ:Math.max(from[1],station[1])+8}}).route
  const order={...f,mission,route:generated,routeIngress:ingress,sortieOrdered:true,strikeTargetId:target?.id,protectedPoint:mission==='defensive-cap'?station:undefined,protectedTargetId:undefined}
  const view=deriveRecoveryPlanningView({...s,squadrons:s.squadrons.map(u=>u.id===f.id?order:u)},f.id,generated,MAX_FLIGHT_DISTANCE[f.role])
  if(!view?.valid)return {...f,sortieOrdered:false}
  const result={...order,route:view.normalizedRoute,plannedRecoveryFieldId:view.intendedField.id}
  return mission==='base-strike'&&validateGroundStrikeOrder(s,result)!==undefined?{...f,sortieOrdered:false}:result
}

/** This is deliberately independent of CPU scoring. Only public geography,
 * recovered player reports and own fields/aircraft affect scripted orders. */
export function competitivePlayerOrders(s:MatchState,policy:PlayerPolicy,ordered:Order=scriptedOrder):MatchState {
  const home=s.playerAssets.find(a=>a.kind==='base')!.position
  const known=s.enemyAssets.filter(a=>!a.hidden&&a.intel==='confirmed'&&a.health>0)
  const base=known.find(a=>a.kind==='base')
  const supports=known.filter(a=>a.kind!=='decoy')
  const sectors:Point[]=[]
  for(let x=-10;x<=10;x+=5)for(let y=-12;y<=12;y+=6) {
    const point:Point=[x,y],range=distance(home,point)
    if(range>10&&range<27)sectors.push(point)
  }
  const interest=(p:Point)=>{
    const region=supports.length?Math.min(...supports.map(a=>distance(a.position,p))):distance(p,[-home[0]*.65,-home[1]*.65])
    const mapped=(s.mappedAreas??[]).some(q=>distance(p,q)<3.4)
    return region+(mapped?30:0)+Math.abs(distance(home,p)-19)*.3
  }
  sectors.sort((a,b)=>interest(a)-interest(b)||a[0]-b[0]||a[1]-b[1])
  const scout=sectors[(s.round-1)%Math.min(3,sectors.length)]??[0,0]
  const threats=known.filter(a=>a.kind==='sam'||a.kind==='aaa')
  const routeRisk=(o:Squadron)=>{
    let exposure=0
    for(let i=1;i<o.route.length;i++) {
      const a=o.route[i-1],b=o.route[i],length=distance(a,b),samples=Math.max(1,Math.ceil(length/.5))
      for(let j=0;j<samples;j++)for(const threat of threats){const t=(j+.5)/samples,p:Point=[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];if(distance(p,threat.position)<(threat.kind==='sam'?3.2:1.9))exposure+=length/samples*(threat.kind==='sam'?12:4)}
    }
    return exposure+routeDistance(o.route)*.12
  }
  const recon=s.squadrons.find(f=>f.role==='recon')!
  const reconOrder=ordered(s,recon,'search-area',base?.position??scout,policy==='flank')
  let fighterIndex=0
  return {...s,squadrons:s.squadrons.map(f=>{
    if(f.aircraft<=0||f.status==='trapped')return {...f,sortieOrdered:false}
    if(f.role==='recon')return reconOrder
    const index=fighterIndex++,launch=formationField(s.playerAssets,f.id)!
    if(base&&policy!=='recon-denial') {
      const angle=Math.atan2(launch.position[1]-base.position[1],launch.position[0]-base.position[0])
      const angles=policy==='flank'?[.7,-.7,1.2,-1.2,0]:[0,.35,-.35,.75,-.75,1.25,-1.25]
      const choices=angles.flatMap(offset=>{
        const release:Point=distance(launch.position,base.position)<=BASE_STRIKE_RANGE?[launch.position[0]+.01,launch.position[1]]:[base.position[0]+Math.cos(angle+offset)*BASE_STRIKE_RANGE,base.position[1]+Math.sin(angle+offset)*BASE_STRIKE_RANGE]
        return [false,true].map(flank=>ordered(s,f,'base-strike',release,flank,base))
      }).filter(o=>o.sortieOrdered!==false)
      return choices.sort((a,b)=>routeRisk(a)-routeRisk(b)||routeDistance(a.route)-routeDistance(b.route))[0]??{...f,sortieOrdered:false}
    }
    if(policy==='recon-denial')return ordered(s,f,'defensive-cap',home)
    if(policy==='forward-fob') {
      const fob=s.playerAssets.find(a=>a.kind==='fob'&&a.health>0&&a.operational!==false)
      if(fob&&launch.id!==fob.id)return ordered(s,f,'transit',fob.position)
    }
    // Screened and defense policies protect the actual collection corridor;
    // the other fighter scouts another sector instead of idling until recon
    // survives. Transit does not grant voluntary fighter interceptions.
    if(index===0&&(policy==='recon-strike'||policy==='heavy-sam')) {
      const midpoint:Point=[(launch.position[0]+scout[0])/2,(launch.position[1]+scout[1])/2]
      return ordered(s,f,'defensive-cap',midpoint)
    }
    const station=sectors[(index+1+(s.round-1)*2)%sectors.length]??scout
    const length=distance(launch.position,station),scale=Math.min(1,18/Math.max(.01,length))
    const reachable:Point=[launch.position[0]+(station[0]-launch.position[0])*scale,launch.position[1]+(station[1]-launch.position[1])*scale]
    return ordered(s,f,'transit',reachable,policy==='flank')
  })}
}

/** Online commands use own live condition and legitimate sensor observations.
 * The policy never receives unobserved ground positions or hostile live tracks.
 * This uses the same fixed-site observation radius as the engine. */
export function playerRtbCommands(s:MatchState,live:RoundResult,nextTick:number):SimulationCommand[] {
  const commands:SimulationCommand[]=[]
  for(const f of s.squadrons.filter(f=>f.role==='recon'&&f.sortieOrdered!==false)) {
    if(live.simulationCommands?.some(c=>c.unitId===f.id))continue
    const frame=live.unitTracks.find(t=>t.unitId===f.id)?.frames.at(-1)
    if(!frame||['recovered','destroyed','grounded','trapped','recovering'].includes(frame.mode))continue
    const seenBase=live.assets.some(a=>a.kind==='base'&&distance(a.position,frame.position)<=FIXED_ASSET_OBSERVATION_RANGE)
    const threatened=live.threatAlerts!.some(t=>t.unitId===f.id)
    if(seenBase||frame.strength<50||threatened&&frame.traveledDistance>8)commands.push({id:`script-rtb-r${s.round}-${f.id}`,unitId:f.id,type:'rtb',issuedAtTick:nextTick})
  }
  return commands
}
export function resolveCompetitiveRound(s:MatchState):RoundResult {
  const simulation=createRoundSimulation(s)
  while(!simulation.complete)simulation.advance(playerRtbCommands(s,simulation.result,simulation.nextTick()))
  return simulation.result
}

/** Place defensive capacity on an observed/known inbound release approach,
 * rather than clustering every new SAM next to the base. */
export function playerSamPlacementValue(s:MatchState,point:Point):number {
  const home=s.playerAssets.find(a=>a.kind==='base')!.position
  const tracks=contactTracksAt(s.lastResult,s.lastResult?.duration??0,home).filter(t=>t.visibility!=='lost'||t.lastSeen>0)
  const base=s.enemyAssets.find(a=>a.kind==='base'&&!a.hidden&&a.intel==='confirmed')
  const sources=tracks.map(t=>t.position)
  if(base)sources.push(base.position)
  if(!sources.length)return -distance(point,home)
  const existing=s.playerAssets.filter(a=>a.kind==='sam'&&a.health>0)
  return sources.reduce((n,source)=>{
    const angle=Math.atan2(source[1]-home[1],source[0]-home[0])
    const approach:Point=[home[0]+Math.cos(angle)*9,home[1]+Math.sin(angle)*9]
    const overlap=existing.reduce((n,a)=>n+Math.exp(-(distance(a.position,approach)**2)/12),0)
    return n+Math.exp(-(distance(point,approach)**2)/12)/(1+overlap)
  },0)
}
