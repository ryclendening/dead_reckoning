import { defenseProfile, SAM_FLIGHT_SECONDS, AAA_FLIGHT_SECONDS, AAA_BURST_INTERVAL } from '../equipmentRules'
import { flightRangeFor } from '../flightRules'
import { BASE_STRIKE_RANGE } from '../campaign'
import { SAM_MISSILES_PER_ROUND, SAM_COOLDOWN_SECONDS } from '../airDefense'
import { axialToPoint } from '../hex'
import { validateAssetPlacement } from '../sideEconomy'
import { formationField, isOperationalAirfield } from '../forwardBasing'
import type { Asset, ConstructibleAssetKind, Point } from '../types'
import type { CpuPlanningView } from './planningView'
import { distance, cpuRouteRisk } from './routes'

export function observedThreat(view: CpuPlanningView): number {
  const recent=view.cpu.traffic.filter(t=>view.round-t.observedRound<=2&&distance(t.position,view.home)<14)
  const identities=new Map(recent.filter(t=>t.identity&&t.trackId).map(t=>[t.trackId!,t.identity!]))
  const contacts=new Map<string,number>()
  for(const t of recent) {
    const key=t.identity??identities.get(t.trackId??'')??t.trackId??`${t.observedRound}:${t.sector}`
    const weight=(t.role==='fighter'?.35:t.role==='recon'?.2:.15)/(1+Math.max(0,view.round-t.observedRound-1))
    contacts.set(key,Math.max(contacts.get(key)??0,weight))
  }
  return Math.min(1,(100-view.homeHealth)/100+[...contacts.values()].reduce((a,b)=>a+b,0))
}
/** Expected strength removed before a radial six-unit strike release. A site
 * beyond the release ring can deliver another volley; a late hit cannot stop it. */
function approachDamage(view:CpuPlanningView,point:Point,kind:'sam'|'aaa',angle:number,upgrades?:Asset['upgrades']):number {
  const dx=point[0]-view.home[0],dy=point[1]-view.home[1]
  const along=dx*Math.cos(angle)+dy*Math.sin(angle), lateral=Math.abs(-dx*Math.sin(angle)+dy*Math.cos(angle))
  const profile=defenseProfile({kind,upgrades})!,radius=profile.range
  if(lateral>radius)return 0
  const reach=Math.sqrt(radius*radius-lateral*lateral),enter=Math.min(20,along+reach),exit=Math.max(BASE_STRIKE_RANGE,along-reach)
  const time=(enter-BASE_STRIKE_RANGE)/(40/22),last=(enter-exit)/(40/22)
  if(enter<BASE_STRIKE_RANGE||time<(kind==='sam'?SAM_FLIGHT_SECONDS:AAA_FLIGHT_SECONDS))return 0
  const shots=kind==='sam'?Math.min(profile.magazine,1+Math.floor(Math.min(time-SAM_FLIGHT_SECONDS,last)/Math.max(.01,profile.cooldown))):Math.min(profile.burstShots,1+Math.floor((time-AAA_FLIGHT_SECONDS)/AAA_BURST_INTERVAL))
  return shots*profile.hitChance*profile.damage
}
function approachSurvival(view:CpuPlanningView,angle:number,extra?:{point:Point;kind:'sam'|'aaa'}):number {
  const damage=view.assets.filter(a=>a.health>0&&a.operational!==false&&(a.kind==='sam'||a.kind==='aaa')).reduce((n,a)=>n+approachDamage(view,a.position,a.kind as 'sam'|'aaa',angle,a.upgrades),0)+(extra?approachDamage(view,extra.point,extra.kind,angle):0)
  // The opening opponent has two fighter formations. Coverage is shared capacity,
  // rather than assuming every missile protects against every aircraft at once.
  return Math.max(0,1-damage/200)
}
function approachBearings(view:CpuPlanningView):number[] {
  const recent=view.cpu.traffic.filter(t=>view.round-t.observedRound<=2)
  const identifiedRecon=new Set(recent.filter(t=>t.role==='recon'&&t.trackId).map(t=>t.trackId))
  const contacts=recent.filter(t=>distance(t.position,view.home)<14&&t.role!=='recon'&&!(t.role==='unknown'&&t.trackId&&identifiedRecon.has(t.trackId)))
  const base=view.cpu.sites.find(s=>s.kind==='base'&&s.health>0),bearings:number[]=[]
  for(const angle of new Set(contacts.map(t=>t.bearing??Math.atan2(t.position[1]-view.home[1],t.position[0]-view.home[0])))) {
    const fighter=contacts.some(t=>t.role==='fighter'&&(t.bearing??Math.atan2(t.position[1]-view.home[1],t.position[0]-view.home[0]))===angle)
    for(const spread of [-Math.PI/8,0,Math.PI/8])bearings.push(...Array.from({length:fighter?3:1},()=>angle+spread))
  }
  if(base){const angle=Math.atan2(base.position[1]-view.home[1],base.position[0]-view.home[0]);for(const spread of [-.15,0,.15])bearings.push(angle+spread,angle+spread)}
  if(!bearings.length)bearings.push(...new Set(recent.filter(t=>distance(t.position,view.home)<14).map(t=>t.bearing??Math.atan2(t.position[1]-view.home[1],t.position[0]-view.home[0]))))
  return bearings.length?bearings:Array.from({length:8},(_,i)=>i*Math.PI/4)
}
export function residualApproachRisk(view:CpuPlanningView):number {
  const angles=approachBearings(view)
  return angles.reduce((n,a)=>n+approachSurvival(view,a),0)/angles.length
}
export function defenseCoverage(view:CpuPlanningView,point:Point,kind:'sam'|'aaa'):number {
  const angles=approachBearings(view)
  return angles.reduce((n,a)=>n+approachSurvival(view,a)-approachSurvival(view,a,{point,kind}),0)/angles.length
}
export function legalPlacements(view: CpuPlanningView, kind: ConstructibleAssetKind): Point[] {
  // Sample only known regions. Bounds of the actual world are deliberately unavailable.
  const centers=[view.home,...(view.cpu.mappedAreas??[]),...view.assets.filter(a=>a.kind==='fob'&&isOperationalAirfield(a)).map(a=>a.position)]
  const candidates=new Map<string,Point>(),visited=new Set<string>()
  for(const center of centers) {
    const row=Math.round(center[1]/1.17), col=Math.round(center[0]/(Math.sqrt(3)*.78)-row/2)
    for(let q=col-4;q<=col+4;q++)for(let r=row-4;r<=row+4;r++) {
      const p=axialToPoint(q,r),key=p.join(',')
      if(visited.has(key))continue
      visited.add(key)
      if(validateAssetPlacement(view.context,kind,p).valid)candidates.set(key,p)
    }
  }
  return [...candidates.values()].sort((a,b)=>a[0]-b[0]||a[1]-b[1])
}
/** Improvement to a named next sortie, after one real Transit round. */
export function forwardValue(view: CpuPlanningView, point: Point): { gain: number; target: Point; name: string } | undefined {
  if(view.round>=5)return undefined // Adapt r4 -> transit r5 -> operation r6 is last useful build.
  const targets=view.cpu.sites.filter(s=>s.health>0&&s.kind==='base').map(s=>({position:s.position,name:s.id,health:s.health}))
  if(!targets.length)return undefined // No infrastructure justified by an unnamed hypothetical target.
  let best:ReturnType<typeof forwardValue>
  for(const fighter of view.cpu.formations.filter(f=>f.role==='fighter'&&f.aircraft>0)) {
    const field=formationField(view.assets,fighter.id),range=flightRangeFor(fighter)
    if(!field||!isOperationalAirfield(field)||distance(field.position,point)>range||distance(view.home,point)>range)continue
    for(const target of targets) {
    const current=Math.max(0,distance(field.position,target.position)-BASE_STRIKE_RANGE)*2, next=Math.max(0,distance(point,target.position)-BASE_STRIKE_RANGE)*2
    const release=(from:Point):Point=>{const d=Math.max(.001,distance(from,target.position)),t=Math.max(0,d-BASE_STRIKE_RANGE)/d;return [from[0]+(target.position[0]-from[0])*t,from[1]+(target.position[1]-from[1])*t]}
    const riskBefore=cpuRouteRisk([field.position,release(field.position),field.position],'fighter',view.cpu.sites,fighter),riskAfter=cpuRouteRisk([point,release(point),point],'fighter',view.cpu.sites,fighter)
    const effect=Math.min(1,60*(fighter.strength??100)/100/Math.max(1,target.health))
    const gain=current>range&&next<=range?effect:next<=range&&riskBefore-riskAfter>20?effect*(riskBefore-riskAfter)/100:0
    if(gain>0&&(!best||gain>best.gain))best={gain,target:target.position,name:target.name}
  }
  }
  return best
}
