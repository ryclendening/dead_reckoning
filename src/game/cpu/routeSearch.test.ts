import { describe,expect,it } from 'vitest'
import { axialToPoint } from '../hex'
import { findThreatAwareRoute, threatExposure, threatRouteCost, type ThreatRouteRequest } from './routeSearch'
import type { Point } from '../types'

const request=(patch:Partial<ThreatRouteRequest>={}):ThreatRouteRequest=>({from:[0,0],goals:[[16,0]],recovery:[0,0],maxDistance:40,maxWaypoints:7,expansionBudget:3000,threats:[],...patch})
describe('fuel-constrained threat-aware A*',()=>{
  it('returns the Euclidean shortest round trip and proves it without expanding a clear map',()=>{
    const result=findThreatAwareRoute(request())!
    expect(result).toMatchObject({route:[[0,0],[16,0]],distance:32,cost:32,expansions:0,optimal:true})
  })
  it('integrates circular threat exposure exactly, including tangency and segments starting inside',()=>{
    const threat={position:[0,0] as Point,radius:2}
    expect(threatExposure([-4,0],[4,0],threat)).toBeCloseTo(4)
    expect(threatExposure([0,0],[4,0],threat)).toBeCloseTo(2)
    expect(threatExposure([-4,2],[4,2],threat)).toBe(0)
    expect(threatExposure([0,0],[0,0],threat)).toBe(0)
  })
  it('finds a lower-cost detour around a known threat and includes the unavoidable direct return',()=>{
    const input=request({threats:[{position:[8,0],radius:2,costPerUnit:8}]})
    const result=findThreatAwareRoute(input)!,direct=threatRouteCost([input.from,input.goals[0]],input.recovery,input.threats)
    expect(result.cost).toBeLessThan(direct-15)
    expect(result.distance).toBeGreaterThan(32)
    expect(result.distance).toBeLessThanOrEqual(40)
    expect(result.route.length).toBeLessThanOrEqual(7)
    expect(result.cost).toBeCloseTo(threatRouteCost(result.route,input.recovery,input.threats))
    expect(findThreatAwareRoute(input)).toEqual(result)
  })
  it('agrees with exhaustive one-bend candidates when it reports optimality',()=>{
    const input=request({maxWaypoints:3,threats:[{position:[8,0],radius:2,costPerUnit:8}]})
    // With source at a hex center and one intermediate waypoint, this graph
    // permits exactly the six lattice rays followed by the exact goal link.
    // Enumerate them independently rather than relying on A*'s visited labels.
    const candidates:Point[][]=[[input.from,input.goals[0]]]
    for(const [q,r] of [[1,0],[-1,0],[0,1],[0,-1],[1,-1],[-1,1]])for(let n=1;n<=30;n++) {
      const p=axialToPoint(q*n,r*n),length=Math.hypot(...p)+Math.hypot(p[0]-16,p[1])+16
      if(length<=40)candidates.push([input.from,p,input.goals[0]])
    }
    const reference=Math.min(...candidates.map(path=>threatRouteCost(path,input.recovery,input.threats)))
    const result=findThreatAwareRoute(input)!
    expect(result.optimal).toBe(true)
    expect(result.cost).toBeCloseTo(reference,7)
  })
  it('keeps the exposed shortest route when detours cannot fit fuel',()=>{
    const result=findThreatAwareRoute(request({maxDistance:32,threats:[{position:[8,0],radius:2,costPerUnit:8}]}))!
    expect(result.route).toEqual([[0,0],[16,0]])
    expect(result.distance).toBe(32)
    expect(result.optimal).toBe(true)
  })
  it('matches an exhaustive two-bend cost/fuel oracle with competing detours',()=>{
    const input=request({goals:[[18,0]],maxDistance:44,maxWaypoints:4,expansionBudget:10000,
      threats:[{position:[7,0],radius:2,costPerUnit:12},{position:[12,-3],radius:2,costPerUnit:4}]})
    const directions=[[1,0],[-1,0],[0,1],[0,-1],[1,-1],[-1,1]]
    const length=(a:Point,b:Point)=>Math.hypot(a[0]-b[0],a[1]-b[1])
    let reference=threatRouteCost([input.from,input.goals[0]],input.recovery,input.threats)
    for(const [q,r] of directions)for(let n=1;n<=32;n++) {
      const a=axialToPoint(q*n,r*n)
      for(const [dq,dr] of [[0,0],...directions])for(let m=0;m<=32;m++) {
        const b=axialToPoint(q*n+dq*m,r*n+dr*m),path=[input.from,a,b,input.goals[0]]
        const distance=length(input.from,a)+length(a,b)+length(b,input.goals[0])+length(input.goals[0],input.recovery)
        if(distance<=44+1e-8)reference=Math.min(reference,threatRouteCost(path,input.recovery,input.threats))
      }
    }
    const result=findThreatAwareRoute(input)!
    expect(result.optimal).toBe(true)
    expect(result.distance).toBeLessThanOrEqual(44)
    expect(result.cost).toBeCloseTo(reference,7)
  })
  it('compares endpoints together, rejects unreachable goals and reports an exhausted search honestly',()=>{
    const input=request({goals:[[16,0],[40,0]],threats:[{position:[8,0],radius:2,costPerUnit:8}],expansionBudget:1})
    const result=findThreatAwareRoute(input)!
    expect(result.expansions).toBe(1)
    expect(result.optimal).toBe(false)
    expect(result.distance).toBeLessThanOrEqual(40)
    expect(findThreatAwareRoute(request({goals:[[40,0]]}))).toBeUndefined()
    const alternative=findThreatAwareRoute(request({goals:[[16,0],[12,8]],threats:input.threats}))!
    expect(alternative.route.at(-1)).toEqual([12,8])
    expect(alternative.cost).toBeLessThan(result.cost)
  })
})
