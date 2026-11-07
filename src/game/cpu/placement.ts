import { axialToPoint } from '../hex'
import { validateAssetPlacement } from '../sideEconomy'
import { formationField, isOperationalAirfield } from '../forwardBasing'
import type { ConstructibleAssetKind, Point } from '../types'
import type { CpuPlanningView } from './planningView'
import { distance, cpuRouteRisk } from './routes'

export function observedThreat(view: CpuPlanningView): number {
  const recent=view.cpu.traffic.filter(t=>view.round-t.observedRound<=2&&distance(t.position,view.home)<12)
  return Math.min(1,(100-view.homeHealth)/100+recent.reduce((sum,t)=>sum+(t.role==='fighter'?.28:.15)/(1+view.round-t.observedRound),0))
}
/** Marginal coverage at possible six-unit release approaches, never hidden orders. */
export function residualApproachRisk(view: CpuPlanningView): number {
  const contacts=view.cpu.traffic.filter(t=>view.round-t.observedRound<=2&&distance(t.position,view.home)<14)
  if(!contacts.length)return 1
  let risk=0,total=0
  for(const contact of contacts)for(const spread of [-.3,0,.3]) {
    const angle=(contact.bearing??Math.atan2(contact.position[1]-view.home[1],contact.position[0]-view.home[0]))+spread
    const p:Point=[view.home[0]+Math.cos(angle)*6,view.home[1]+Math.sin(angle)*6]
    risk+=view.assets.filter(a=>a.health>0&&(a.kind==='sam'||a.kind==='aaa')).reduce((v,a)=>v*(distance(a.position,p)<=(a.kind==='sam'?3.2:1.9)?(a.kind==='sam'?.3:.75):1),1)
    total++
  }
  return risk/total
}
export function defenseCoverage(view: CpuPlanningView, point: Point, kind: 'sam'|'aaa'): number {
  const contacts=view.cpu.traffic.filter(t=>view.round-t.observedRound<=2&&distance(t.position,view.home)<14)
  const bearings=contacts.length?contacts.map(t=>t.bearing??Math.atan2(t.position[1]-view.home[1],t.position[0]-view.home[0])):Array.from({length:8},(_,i)=>i*Math.PI/4)
  let gain=0,total=0
  for(const angle of bearings)for(const spread of [-.3,0,.3])for(const r of [5,6,7,8]) {
    const p:Point=[view.home[0]+Math.cos(angle+spread)*r,view.home[1]+Math.sin(angle+spread)*r]
    const prior=view.assets.filter(a=>a.health>0&&(a.kind==='sam'||a.kind==='aaa')).reduce((survival,a)=>survival*(distance(a.position,p)<=(a.kind==='sam'?3.2:1.9)?(a.kind==='sam'?.3:.75):1),1)
    gain+=(distance(point,p)<=(kind==='sam'?3.2:1.9)?(kind==='sam'?.7:.25):0)*prior
    total++
  }
  return total?gain/total:0
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
  const fighter=view.cpu.formations.find(f=>f.role==='fighter')!, field=formationField(view.assets,fighter.id)
  if(!field||!isOperationalAirfield(field)||fighter.aircraft<=0||distance(field.position,point)>40||distance(view.home,point)>40)return undefined
  const targets=view.cpu.sites.filter(s=>s.health>0&&s.kind==='base').map(s=>({position:s.position,name:s.id,health:s.health}))
  if(!targets.length)return undefined // No infrastructure justified by an unnamed hypothetical target.
  let best:ReturnType<typeof forwardValue>
  for(const target of targets) {
    const current=Math.max(0,distance(field.position,target.position)-5.9)*2, next=Math.max(0,distance(point,target.position)-5.9)*2
    const release=(from:Point):Point=>{const d=Math.max(.001,distance(from,target.position)),t=Math.max(0,d-5.9)/d;return [from[0]+(target.position[0]-from[0])*t,from[1]+(target.position[1]-from[1])*t]}
    const riskBefore=cpuRouteRisk([field.position,release(field.position),field.position],'fighter',view.cpu.sites),riskAfter=cpuRouteRisk([point,release(point),point],'fighter',view.cpu.sites)
    const effect=Math.min(1,60*(fighter.strength??100)/100/Math.max(1,target.health))
    const gain=current>40&&next<=40?effect:next<=40&&riskBefore-riskAfter>20?effect*(riskBefore-riskAfter)/100:0
    if(gain>0&&(!best||gain>best.gain))best={gain,target:target.position,name:target.name}
  }
  return best
}
