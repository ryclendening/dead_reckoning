import {describe,expect,it} from 'vitest'
import {DEFENSIVE_CAP_PURSUIT_BUFFER,DEFENSIVE_CAP_RESPONSIBILITY_RADIUS,FORWARD_PATROL_RESPONSIBILITY_HALF_WIDTH,capMayContinuePursuit,estimateEscortCoverage,escortCoverageLabel,fighterIsResponsibleFor,fighterResponsibilityFor,mayContinueMissionPursuit,nearestResponsibleContact,preferredObjectiveThreat,protectTargetSelectionFor,protectThreatPriority,responsibilityContains} from './missionResponsibility'
import type {MissionId,Point,Squadron} from './types'

const fighter=(mission:MissionId,route:Point[],routeIngress=route):Squadron=>({id:'fighter',callsign:'TEST',role:'fighter',mission,aircraft:4,maxAircraft:4,damaged:0,readiness:100,ammo:100,route,routeIngress})

describe('mission responsibility',()=>{
  it('clears target selection on mission change, formation change, or step exit',()=>{
    expect(protectTargetSelectionFor('mission','defensive-cap')).toBe(true)
    expect(protectTargetSelectionFor('mission','base-strike')).toBe(false)
    expect(protectTargetSelectionFor('formation','defensive-cap')).toBe(false)
    expect(protectTargetSelectionFor('exit','defensive-cap')).toBe(false)
  })

  it('prioritizes only visible threats relevant to the protected objective',()=>{
    expect(protectThreatPriority({protectsHomeBase:true,escortsFlight:false,identifiedByVisual:true,role:'recon'})).toBe(2)
    expect(protectThreatPriority({protectsHomeBase:true,escortsFlight:false,identifiedByVisual:true,role:'fighter'})).toBe(0)
    expect(protectThreatPriority({protectsHomeBase:false,escortsFlight:true,identifiedByVisual:true,role:'fighter'})).toBe(2)
    expect(protectThreatPriority({protectsHomeBase:false,escortsFlight:true,identifiedByVisual:false,role:'fighter'})).toBe(0)
  })

  it('keeps the sensor, leash, and fuel gates when choosing the protected objective threat',()=>{
    const contacts=[
      {id:'radar-recon',position:[1,0] as Point,source:'radar' as const,role:'recon' as const},
      {id:'visible-fighter',position:[2,0] as Point,source:'visual' as const,role:'fighter' as const},
      {id:'visible-recon',position:[3,0] as Point,source:'visual' as const,role:'recon' as const},
    ]
    const picked=preferredObjectiveThreat({contacts,protectsHomeBase:true,escortsFlight:false,from:[0,0],isResponsible:()=>true,isReachable:contact=>contact.id!=='visible-recon'})
    expect(picked?.id).toBeUndefined()
    expect(preferredObjectiveThreat({contacts,protectsHomeBase:true,escortsFlight:false,from:[0,0],isResponsible:()=>true,isReachable:()=>true})?.id).toBe('visible-recon')
    expect(preferredObjectiveThreat({contacts,protectsHomeBase:false,escortsFlight:true,from:[0,0],isResponsible:()=>true,isReachable:()=>true})?.id).toBe('visible-fighter')
  })

  it('labels partial escort coverage explicitly',()=>{
    expect(escortCoverageLabel(64)).toBe('PARTIAL COVER · 64% · 36% UNCOVERED')
    expect(escortCoverageLabel(100)).toBe('FULL COVER · 100%')
  })

  it('derives Defensive CAP from the final ingress point with an inclusive 4.5-unit boundary',()=>{
    const squadron=fighter('defensive-cap',[[0,0],[5,0],[5,1]],[[0,0],[5,0]])
    const area=fighterResponsibilityFor(squadron)!
    expect(area).toEqual({kind:'circle',center:[5,0],radius:DEFENSIVE_CAP_RESPONSIBILITY_RADIUS})
    expect(responsibilityContains(area,[9.5,0])).toBe(true)
    expect(responsibilityContains(area,[9.501,0])).toBe(false)
  })

  it('keeps an acquired CAP contact only through the small edge buffer',()=>{
    const squadron=fighter('defensive-cap',[[0,0],[5,0]],[[0,0],[5,0]])
    const edge=5+DEFENSIVE_CAP_RESPONSIBILITY_RADIUS
    expect(DEFENSIVE_CAP_PURSUIT_BUFFER).toBe(.35)
    expect(fighterIsResponsibleFor(squadron,[edge+.1,0])).toBe(false)
    expect(capMayContinuePursuit(squadron,[edge+.1,0])).toBe(true)
    expect(capMayContinuePursuit(squadron,[edge+DEFENSIVE_CAP_PURSUIT_BUFFER,0])).toBe(true)
    expect(capMayContinuePursuit(squadron,[edge+DEFENSIVE_CAP_PURSUIT_BUFFER+.001,0])).toBe(false)
  })

  it('uses the complete multi-segment Forward Patrol route with an inclusive 2.5-unit corridor',()=>{
    const squadron=fighter('forward-patrol',[[0,0],[5,0],[5,5]])
    expect(FORWARD_PATROL_RESPONSIBILITY_HALF_WIDTH).toBe(2.5)
    expect(fighterIsResponsibleFor(squadron,[2.5,2.5])).toBe(true)
    expect(fighterIsResponsibleFor(squadron,[7.5,4])).toBe(true)
    expect(fighterIsResponsibleFor(squadron,[7.501,4])).toBe(false)
  })

  it('limits patrol responsibility to the station pattern and uses the visible edge as its leash',()=>{
    const squadron=fighter('forward-patrol',[[0,0],[5,0],[5,1],[6,1]],[[0,0],[5,0]])
    const area=fighterResponsibilityFor(squadron)!
    expect(area.kind).toBe('corridor')
    expect(fighterIsResponsibleFor(squadron,[1,0])).toBe(false)
    expect(fighterIsResponsibleFor(squadron,[5,1])).toBe(true)
    expect(mayContinueMissionPursuit(squadron,[5,1+FORWARD_PATROL_RESPONSIBILITY_HALF_WIDTH-.01])).toBe(true)
    expect(mayContinueMissionPursuit(squadron,[5,1+FORWARD_PATROL_RESPONSIBILITY_HALF_WIDTH+.01])).toBe(false)
  })

  it('anchors Protect on a chosen point or a supplied moving-flight position',()=>{
    const protect={...fighter('defensive-cap',[[0,0],[1,0]]),protectedPoint:[4,2] as Point}
    expect(fighterResponsibilityFor(protect)?.kind==='circle'&&(fighterResponsibilityFor(protect) as {center:Point}).center).toEqual([4,2])
    expect((fighterResponsibilityFor({...protect,protectedTargetId:'recon'},[8,3]) as {center:Point}).center).toEqual([8,3])
    expect(fighterResponsibilityFor({...protect,protectedTargetId:'recon'})).toBeUndefined()
  })

  it('estimates useful short escort overlap and reports uncovered long routes',()=>{
    const short=estimateEscortCoverage({escortRoute:[[0,0]],protectedRoute:[[0,0],[0,6]],escortSpeed:40/22,protectedSpeed:48/22,recoveryPoint:[0,0],maxDistance:40})
    const long=estimateEscortCoverage({escortRoute:[[0,0]],protectedRoute:[[0,0],[0,44]],escortSpeed:40/22,protectedSpeed:48/22,recoveryPoint:[0,0],maxDistance:40})
    expect(short.recoveryFeasible).toBe(true)
    expect(short.fullyCovered).toBe(true)
    expect(long.percent).toBeLessThan(100)
    expect(long.recoveryFeasible).toBe(false)
  })

  it('gives recon no fighter responsibility geometry',()=>{
    const recon={...fighter('search-area',[[0,0],[4,0]]),role:'recon' as const}
    expect(fighterResponsibilityFor(recon)).toBeUndefined()
    expect(fighterIsResponsibleFor(recon,[2,0])).toBe(false)
  })

  it('chooses the nearest reachable in-area contact with a stable ID tie-break',()=>{
    const squadron=fighter('defensive-cap',[[0,0],[0,0]])
    const contacts=[{id:'zulu',position:[2,0] as Point},{id:'alpha',position:[-2,0] as Point},{id:'near-unreachable',position:[1,0] as Point},{id:'outside',position:[5,0] as Point}]
    expect(nearestResponsibleContact(squadron,[0,0],contacts,item=>item.id!=='near-unreachable')?.id).toBe('alpha')
  })

  it('protects the CAP center while patrol hunts visually identified fighters',()=>{
    const contacts=[{id:'fighter',position:[4,0] as Point,identifiedRole:'fighter' as const},{id:'recon',position:[1,0] as Point,identifiedRole:'recon' as const}]
    expect(nearestResponsibleContact(fighter('defensive-cap',[[0,0],[0,0]]),[4,0],contacts,()=>true)?.id).toBe('recon')
    expect(nearestResponsibleContact(fighter('forward-patrol',[[0,0],[5,0]]),[0,0],contacts,()=>true)?.id).toBe('fighter')
    expect(nearestResponsibleContact(fighter('forward-patrol',[[0,0],[5,0]]),[0,0],contacts.map(({identifiedRole,...contact})=>contact),()=>true)?.id).toBe('recon')
  })

  it('is deterministic from mission geometry and contacts alone',()=>{
    const squadron=fighter('forward-patrol',[[0,0],[5,0]])
    const contacts=[{id:'b',position:[3,1] as Point},{id:'a',position:[3,-1] as Point}]
    expect(nearestResponsibleContact(squadron,[0,0],contacts,()=>true)).toEqual(nearestResponsibleContact(structuredClone(squadron),[0,0],structuredClone(contacts),()=>true))
  })
})
