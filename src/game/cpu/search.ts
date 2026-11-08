import type { Point, Squadron } from '../types'
import type { CpuPlanningView } from './planningView'
import { distance } from './routes'

export function segmentDistance(p:Point,a:Point,b:Point):number {
  const dx=b[0]-a[0],dy=b[1]-a[1],length=dx*dx+dy*dy
  const t=length?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/length)):0
  return distance(p,[a[0]+t*dx,a[1]+t*dy])
}
export function covers(route:Point[],p:Point,radius=3.8):boolean {
  return route.slice(1).some((b,i)=>segmentDistance(p,route[i],b)<=radius)
}
/** A small derived prior from public deployment geometry and recovered sites.
 * No seed, hidden bounds, opponent coordinates, or synthetic persistent map. */
export function searchPrior(view:CpuPlanningView):Array<{point:Point;weight:number}> {
  const supports=view.cpu.sites.filter(s=>s.health>0&&s.kind!=='base'&&s.kind!=='decoy')
  const points:Array<{point:Point;weight:number}>=[]
  for(let x=-12;x<=12;x+=2)for(let y=-14;y<=14;y+=2) {
    const point:Point=[x,y],range=distance(view.home,point)
    if(range<12||range>27)continue
    if((view.cpu.mappedAreas??[]).some(p=>distance(p,point)<3.4))continue
    const central=Math.exp(-(Math.max(0,Math.abs(x)-7.5)**2)/12-Math.max(0,Math.abs(y)-9)**2/12)
    const separation=Math.exp(-(((range-19.5)/3)**2))
    const evidence=supports.length?Math.exp(-(Math.min(...supports.map(s=>distance(s.position,point)))**2)/32):1
    points.push({point,weight:central*separation*evidence*Math.exp(0-((x+view.home[0]*.65)/9)**2-((y+view.home[1]*.65)/9)**2)})
  }
  return points
}
/** Independent returned-report probabilities combine as a coverage union.
 * This is exactly the exhaustive subset expectation for one required report. */
export function collectionScorer(view:CpuPlanningView,prior=searchPrior(view)):(orders:Squadron[],confidence?:(order:Squadron)=>number)=>number {
  const base=view.cpu.sites.find(s=>s.kind==='base'&&s.health>0)
  const points=base?Array.from({length:8},(_,i)=>({point:[base.position[0]+Math.cos(i*Math.PI/4)*3.2,base.position[1]+Math.sin(i*Math.PI/4)*3.2] as Point,weight:1})):prior
  const total=points.reduce((n,p)=>n+p.weight,0)
  const known=new Set(view.cpu.sites.filter(s=>['sam','aaa','radar'].includes(s.kind)).map(s=>s.kind)).size
  const interest=base?.health? .08*Math.max(0,3-known)/3+.04*Math.min(1,Math.max(0,view.round-base.observedRound)/2):1
  const cache=new WeakMap<Squadron,boolean[]>()
  return (orders,confidence=()=>1)=>{
    const flying=orders.filter(o=>o.sortieOrdered!==false),probabilities=flying.map(o=>Math.max(0,Math.min(1,confidence(o))))
    const coverage=flying.map(o=>{let mask=cache.get(o);if(!mask){mask=points.map(p=>covers(o.route,p.point));cache.set(o,mask)}return mask})
    let value=0
    for(let i=0;i<points.length;i++) {
      let missed=1
      for(let j=0;j<flying.length;j++)if(coverage[j][i])missed*=1-probabilities[j]
      value+=points[i].weight*(1-missed)
    }
    return total?interest*value/total:0
  }
}
