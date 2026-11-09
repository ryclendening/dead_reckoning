import { aircraftSensorRange } from '../aircraftTypes'
import { defenseProfile, SAM_FLIGHT_SECONDS, AAA_FLIGHT_SECONDS, AAA_BURST_INTERVAL } from '../equipmentRules'
import { flightSpeedFor } from '../flightRules'
import type { Point, Squadron } from '../types'
import type { CpuPlanningView } from './planningView'
import { distance } from './routes'

export interface FlightForecast { order:Squadron; probability:number }
export interface ReconForecasts { paths:(order:Squadron)=>FlightForecast[]; launchRisk:(order:Squadron)=>number }
/** First intersection with a static known envelope, in route-distance units.
 * This forecasts opportunities; it never substitutes a hidden live track. */
function firstEntry(route:Point[],center:Point,radius:number):{distance:number;prefix:Point[]}|undefined {
  let traveled=0
  for(let i=1;i<route.length;i++) {
    const a=route[i-1],b=route[i],dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy)
    if(distance(a,center)<=radius)return {distance:traveled,prefix:route.slice(0,i)}
    if(!length)continue
    const x=a[0]-center[0],y=a[1]-center[1],projection=x*dx+y*dy,disc=projection*projection-length*length*(x*x+y*y-radius*radius)
    if(disc>=0){const t=(-projection-Math.sqrt(disc))/(length*length);if(t>=0&&t<=1)return {distance:traveled+t*length,prefix:[...route.slice(0,i),[a[0]+t*dx,a[1]+t*dy]]}}
    traveled+=length
  }
  return undefined
}

/** Conservative branches end collection at a possible direct threat and reserve
 * return to the committed field. Original executable orders remain unchanged.
 * Fixed sites are stationary; old fighter sectors are uncertain, mutually
 * exclusive first-contact outcomes, never exact current enemy positions. */
export function reconForecasts(view:CpuPlanningView):ReconForecasts {
  const cache=new WeakMap<Squadron,FlightForecast[]>()
  const launchRisks=new WeakMap<Squadron,number>()
  const paths=(order:Squadron)=>{
    let result=cache.get(order);if(result)return result
    result=[{order,probability:1}]
    if(order.role==='recon'&&order.sortieOrdered!==false&&order.reconPosture==='conservative') {
      const recovery=view.assets.find(a=>a.id===order.plannedRecoveryFieldId)?.position??view.home
      const hazards:Array<{key:string;distance:number;prefix:Point[];probability:number;launchRisk?:number}>=[]
      for(const site of view.cpu.sites.filter(s=>s.health>0)) {
        const profile=defenseProfile(site),entry=profile&&firstEntry(order.route,site.position,profile.range)
        if(entry){
          const returnSeconds=distance(entry.prefix.at(-1)!,recovery)/flightSpeedFor(order)
          const shots=site.kind==='sam'?(SAM_FLIGHT_SECONDS<=returnSeconds?1:0):Math.max(0,Math.min(profile!.burstShots,1+Math.floor((returnSeconds-AAA_FLIGHT_SECONDS)/AAA_BURST_INTERVAL)))
          hazards.push({key:site.id,...entry,probability:1,launchRisk:shots*profile!.hitChance*profile!.damage})
        }
      }
      const strength=order.strength??order.aircraft/Math.max(1,order.maxAircraft)*100
      const radius=aircraftSensorRange(order)*(.68+.32*Math.max(0,Math.min(1,strength/100)))
      const fighters=new Map<string,typeof hazards[number]>()
      for(const t of view.cpu.traffic.filter(t=>t.role==='fighter'&&view.round-t.observedRound<=2)) {
        const entry=firstEntry(order.route,t.position,radius);if(!entry)continue
        const key=t.identity??`${t.observedRound}:${t.trackId??t.position.join(',')}`
        const hazard={key,...entry,probability:1/(2+Math.max(0,view.round-t.observedRound))}
        if(!fighters.has(key)||fighters.get(key)!.distance>entry.distance)fighters.set(key,hazard)
      }
      hazards.push(...fighters.values());hazards.sort((a,b)=>a.distance-b.distance||a.key.localeCompare(b.key))
      let remaining=1;result=[]
      for(const hazard of hazards) {
        if(remaining<=0)break
        const probability=remaining*hazard.probability
        const returning={...order,route:[...hazard.prefix,recovery]}
        launchRisks.set(returning,hazard.launchRisk??0)
        result.push({order:returning,probability})
        remaining*=1-hazard.probability
      }
      if(remaining>0)result.push({order,probability:remaining})
    }
    cache.set(order,result);return result
  }
  return {paths,launchRisk:order=>launchRisks.get(order)??0}
}
