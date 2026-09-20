import {describe,expect,it} from 'vitest'
import {DEFENSIVE_CAP_RESPONSIBILITY_RADIUS,FORWARD_PATROL_RESPONSIBILITY_HALF_WIDTH,fighterIsResponsibleFor,fighterResponsibilityFor,nearestResponsibleContact,responsibilityContains} from './missionResponsibility'
import type {MissionId,Point,Squadron} from './types'

const fighter=(mission:MissionId,route:Point[],routeIngress=route):Squadron=>({id:'fighter',callsign:'TEST',role:'fighter',mission,aircraft:4,maxAircraft:4,damaged:0,readiness:100,ammo:100,route,routeIngress})

describe('mission responsibility',()=>{
  it('derives Defensive CAP from the final ingress point with an inclusive 4.5-unit boundary',()=>{
    const squadron=fighter('defensive-cap',[[0,0],[5,0],[5,1]],[[0,0],[5,0]])
    const area=fighterResponsibilityFor(squadron)!
    expect(area).toEqual({kind:'circle',center:[5,0],radius:DEFENSIVE_CAP_RESPONSIBILITY_RADIUS})
    expect(responsibilityContains(area,[9.5,0])).toBe(true)
    expect(responsibilityContains(area,[9.501,0])).toBe(false)
  })

  it('uses the complete multi-segment Forward Patrol route with an inclusive 2.5-unit corridor',()=>{
    const squadron=fighter('forward-patrol',[[0,0],[5,0],[5,5]])
    expect(FORWARD_PATROL_RESPONSIBILITY_HALF_WIDTH).toBe(2.5)
    expect(fighterIsResponsibleFor(squadron,[2.5,2.5])).toBe(true)
    expect(fighterIsResponsibleFor(squadron,[7.5,4])).toBe(true)
    expect(fighterIsResponsibleFor(squadron,[7.501,4])).toBe(false)
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

  it('is deterministic from mission geometry and contacts alone',()=>{
    const squadron=fighter('forward-patrol',[[0,0],[5,0]])
    const contacts=[{id:'b',position:[3,1] as Point},{id:'a',position:[3,-1] as Point}]
    expect(nearestResponsibleContact(squadron,[0,0],contacts,()=>true)).toEqual(nearestResponsibleContact(structuredClone(squadron),[0,0],structuredClone(contacts),()=>true))
  })
})
