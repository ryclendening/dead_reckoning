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
export function collectionScorer(view:CpuPlanningView,prior=searchPrior(view)):(orders:Squadron[],confidence?:(order:Squadron)=>number)=>number {
  const base=view.cpu.sites.find(s=>s.kind==='base'&&s.health>0),total=prior.reduce((n,p)=>n+p.weight,0)
  const cache=new WeakMap<Squadron,boolean[]>()
  return (orders,confidence=()=>1)=>{
    const flying=orders.filter(o=>o.sortieOrdered!==false),probabilities=flying.map(o=>Math.max(0,Math.min(1,confidence(o))))
    // Two own observers: analytically combine their possible returned reports.
    // This is collection uncertainty, not a simulated opponent policy.
    const expected=(effect:(returned:Squadron[])=>number)=>{
      let value=0
      for(let mask=0;mask<1<<flying.length;mask++) {
        let probability=1;const returned:Squadron[]=[]
        for(let i=0;i<flying.length;i++){const present=!!(mask&(1<<i));probability*=present?probabilities[i]:1-probabilities[i];if(present)returned.push(flying[i])}
        value+=probability*effect(returned)
      }
      return value
    }
    if(base) {
      if(view.exposure<60)return expected(returned=>Math.min(1,returned.filter(o=>covers(o.route,base.position,3.75)).reduce((n,o)=>n+(view.cpu.sites.some(s=>s.kind==='decoy'&&s.health>0&&covers(o.route,s.position))?20:40),0)/Math.max(1,60-view.exposure)))
      const known=new Set(view.cpu.sites.filter(s=>['sam','aaa','radar'].includes(s.kind)).map(s=>s.kind)).size
      const interest=.08*Math.max(0,3-known)/3+.04*Math.min(1,Math.max(0,view.round-base.observedRound)/2)
      const sectors=Array.from({length:8},(_,i)=>[base.position[0]+Math.cos(i*Math.PI/4)*3.2,base.position[1]+Math.sin(i*Math.PI/4)*3.2] as Point)
      return expected(returned=>interest*sectors.filter(p=>returned.some(o=>covers(o.route,p))).length/sectors.length)
    }
    for(const o of flying)if(!cache.has(o))cache.set(o,prior.map(p=>covers(o.route,p.point)))
    return total?expected(returned=>prior.reduce((n,p,i)=>{const observers=returned.filter(o=>cache.get(o)![i]).length;return n+p.weight*(observers>=2?1:observers===1?.45:0)},0)/total):0
  }
}
