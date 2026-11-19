import {describe,expect,it} from 'vitest'
import {createMatch} from './data'
import {applyRound,createRoundSimulation,FLIGHT_SPEED,MAX_FLIGHT_DISTANCE,resolveRound} from './engine'
import {beginNextRound,openAdaptPhase} from './economy'
import {deriveRecoveryPlanningView,formationField,routeToRecoveryField,validateRecoveryPackage} from './forwardBasing'
import {flightRangeFor} from './flightRules'
import {generateRouteTemplate} from './routeTemplates'
import {observedGroundSiteIdsAt} from './executionProjection'
import {RADAR_BASE_RANGE} from './equipmentRules'
import {FIXED_ASSET_OBSERVATION_RANGE} from './siteObservation'
import type {Asset,Point,Role} from './types'

const edgeRoute=(match:ReturnType<typeof createMatch>):Point[]=>{const base=match.world.friendlyTerritory.center;return [base,[base[0],base[1]>=0?match.world.bounds.minZ-8:match.world.bounds.maxZ+8]]}
const onlyRaven=(match:ReturnType<typeof createMatch>)=>({...match,squadrons:match.squadrons.map(squadron=>squadron.id==='raven'?{...squadron,mission:'search-area' as const,route:edgeRoute(match),routeIngress:edgeRoute(match)}:{...squadron,aircraft:0,strength:0})})

function radarObservationTrial(role:Role){
  const state=createMatch(7301)
  const id=role==='recon'?'raven':'viper'
  const home:Point=[0,0], leg:Point[]=[home,[0,6.25],home]
  const base={...state.enemyAssets.find(asset=>asset.kind==='base')!,position:[0,13.75] as Point}
  const radar={...state.enemyAssets.find(asset=>asset.kind==='radar')!,position:[1.6,13.75] as Point}
  const offlineRadar={...radar,id:'e-offline-radar',position:[-1.6,13.75] as Point,operational:false}
  state.playerAssets=state.playerAssets.filter(asset=>asset.kind==='base').map(asset=>({...asset,position:home}))
  state.enemyAssets=[base,radar,offlineRadar]
  state.squadrons=state.squadrons.map(formation=>({...formation,sortieOrdered:formation.id===id,
    ...(formation.id===id&&role==='bomber'?{role,aircraftTypeId:'bomber'}:{}),
    mission:'transit',route:leg,routeIngress:leg,plannedRecoveryFieldId:'p-base'}))
  state.cpu!.plan={round:state.round,objective:'defend',reason:'Isolate ground observation',candidates:[],
    orders:state.cpu!.formations.map(formation=>({...formation,sortieOrdered:false}))}
  return {state,id,base,radar,offlineRadar}
}

describe('reconnaissance exploration recovery',()=>{
  it('spots operating radar beyond radar coverage on a recon sortie',()=>{
    const {state,id,base,radar,offlineRadar}=radarObservationTrial('recon')
    const simulation=createRoundSimulation(state)
    expect(observedGroundSiteIdsAt(simulation.result,0).size).toBe(0)
    while(!simulation.complete&&!observedGroundSiteIdsAt(simulation.result,simulation.result.duration).has(radar.id))simulation.advance()
    expect(simulation.complete).toBe(false)
    const frame=simulation.result.unitTracks.find(track=>track.unitId===id)!.frames.at(-1)!
    const separation=Math.hypot(frame.position[0]-radar.position[0],frame.position[1]-radar.position[1])
    expect(separation).toBeGreaterThan(RADAR_BASE_RANGE)
    expect(simulation.result.contactObservations.find(observation=>observation.targetId===radar.id)?.source)
      .toBe('visual')
    expect(simulation.result.intelReports).toEqual([])
    expect(simulation.result.assets.find(asset=>asset.id===radar.id)?.hidden).toBe(true)

    while(!simulation.complete)simulation.advance()
    expect(simulation.result.cpuReport!.traffic).toEqual([])
    const expected=[base.id,radar.id,offlineRadar.id]
    expect(simulation.result.intelReports.filter(report=>report.recovered).map(report=>report.assetId))
      .toEqual(expect.arrayContaining(expected))
    expect(simulation.result.intelReports).toHaveLength(expected.length)
    expect(observedGroundSiteIdsAt(simulation.result,simulation.result.duration).size).toBe(0)
    expect(applyRound(state,simulation.result).enemyAssets.find(asset=>asset.id===radar.id)?.intel).toBe('confirmed')
  })

  it.each(['fighter','bomber'] as const)('keeps radar hidden outside visual range for a %s',role=>{
    const {state,id,radar}=radarObservationTrial(role)
    const result=resolveRound(state)
    expect(result.recoveryOutcomes).toContainEqual(expect.objectContaining({formationId:id,outcome:'recovered'}))
    expect(result.contactObservations).toEqual([])
    expect(result.intelReports).toEqual([])
    expect(applyRound(state,result).enemyAssets.find(asset=>asset.id===radar.id))
      .toMatchObject({hidden:true,intel:'unknown'})
  })

  it('stages recon at a FOB, then launches from it and recovers outbound and return observations at home', () => {
    const state = createMatch(7301)
    const home: Asset = { ...state.playerAssets.find(asset => asset.kind === 'base')!, position: [0,0] }
    const fob: Asset = { ...home, id: 'p-fob-1', kind: 'fob', position: [6,0], operational: true, capacity: 2, basedFormationIds: [] }
    const enemyBase: Asset = { ...state.enemyAssets.find(asset => asset.kind === 'base')!, position: [15,12] }
    const outboundSite: Asset = { ...enemyBase, id: 'e-outbound-radar', kind: 'radar', position: [6,9] }
    const returnSite: Asset = { ...outboundSite, id: 'e-return-radar', position: [-5,9] }
    const detour: Point = [2,-2]
    state.playerAssets = [home,fob]
    state.enemyAssets = [enemyBase,outboundSite,returnSite]
    state.squadrons = state.squadrons.map(formation => formation.id === 'raven'
      ? { ...formation, mission: 'transit', routeIngress: [home.position,detour], plannedRecoveryFieldId: fob.id, sortieOrdered: true }
      : { ...formation, sortieOrdered: false })
    const raven = state.squadrons.find(formation => formation.id === 'raven')!
    const ordered = new Set([raven.id])
    raven.route = routeToRecoveryField(state,raven.id,fob.id)!
    raven.routeIngress = raven.route
    expect(validateRecoveryPackage(state,flightRangeFor,ordered)).toEqual({ valid: true })
    const holdCpu = (match: typeof state) => {
      match.cpu!.plan = { round: match.round, objective: 'defend', reason: 'Isolate player recon.', candidates: [],
        orders: match.cpu!.formations.map(formation => ({ ...formation, sortieOrdered: false })) }
    }
    holdCpu(state)

    const transit = resolveRound(state)
    expect(transit.executionRoutes[raven.id][0]).toEqual(home.position)
    expect(transit.executionRoutes[raven.id]).toContainEqual(detour)
    expect(transit.recoveryOutcomes).toContainEqual(expect.objectContaining({
      formationId: raven.id, launchFieldId: home.id, actualFieldId: fob.id, outcome: 'recovered',
    }))
    expect(transit.intelReports).toEqual([])

    const next = beginNextRound(openAdaptPhase(applyRound(state,transit)))
    expect(formationField(next.playerAssets,raven.id)?.id).toBe(fob.id)
    const basedRecon = next.squadrons.find(formation => formation.id === raven.id)!
    expect(basedRecon.routeIngress).toEqual([fob.position])
    const ingress: Point[] = [fob.position,outboundSite.position,[9,9]]
    const route = generateRouteTemplate({ template: 'search-area', ingress,
      maxDistance: flightRangeFor(basedRecon), bounds: next.world.presentationBounds }).route
    expect(route).toEqual(ingress)
    Object.assign(basedRecon,{ mission: 'search-area', route, routeIngress: ingress,
      plannedRecoveryFieldId: home.id, recoveryWaypoints: [returnSite.position], sortieOrdered: true })
    next.squadrons = next.squadrons.map(formation => formation.id === raven.id ? formation : { ...formation, sortieOrdered: false })
    expect(validateRecoveryPackage(next,flightRangeFor,ordered)).toEqual({ valid: true })
    holdCpu(next)

    const simulation = createRoundSimulation(next)
    while (!simulation.complete && !simulation.result.executionRoutes[raven.id].some(point => point[0] === outboundSite.position[0] && point[1] === outboundSite.position[1])) {
      simulation.advance()
    }
    expect(simulation.complete).toBe(false)
    expect(simulation.result.assets.find(asset => asset.id === outboundSite.id)).toMatchObject({ intel: 'unknown', hidden: true })
    expect(simulation.result.intelReports).toEqual([])
    while (!simulation.complete) simulation.advance()
    const result = simulation.result
    const track = result.unitTracks.find(unit => unit.unitId === raven.id)!.frames
    expect(track[0].position).toEqual(fob.position)
    expect(track).toContainEqual(expect.objectContaining({ position: returnSite.position, mode: 'recovering' }))
    expect(track.at(-1)).toMatchObject({ position: home.position, mode: 'recovered' })
    expect(result.recoveryOutcomes).toContainEqual(expect.objectContaining({
      formationId: raven.id, launchFieldId: fob.id, plannedFieldId: home.id, actualFieldId: home.id, outcome: 'recovered',
    }))

    const settled = applyRound(next,result)
    expect(formationField(settled.playerAssets,raven.id)?.id).toBe(home.id)
    for (const site of [outboundSite,returnSite]) {
      expect(result.intelReports).toContainEqual(expect.objectContaining({ observerId: raven.id, assetId: site.id, recovered: true }))
      expect(settled.enemyAssets.find(asset => asset.id === site.id)).toMatchObject({ intel: 'confirmed', hidden: false })
      expect(result.mappedAreas.some(point => Math.hypot(point[0] - site.position[0], point[1] - site.position[1]) < 1)).toBe(true)
    }
  })

  it('lets recon fly beyond the fighter allowance without flying faster',()=>{
    const initial=createMatch(7301),home=initial.world.friendlyTerritory.center
    const route:Point[]=[home,[home[0]+9,home[1]],[home[0]-9,home[1]],[home[0]+9,home[1]],home]
    const state={...initial,debugScenario:'fighter-recon' as const,enemyAssets:[],squadrons:initial.squadrons.map(squadron=>({...squadron,sortieOrdered:squadron.id==='raven',...(squadron.id==='raven'?{route,routeIngress:route}:{})}))}
    expect(MAX_FLIGHT_DISTANCE.recon).toBe(64)
    expect(deriveRecoveryPlanningView(state,'raven',route,MAX_FLIGHT_DISTANCE.recon)?.valid).toBe(true)
    const result=resolveRound(state),frames=result.unitTracks.find(track=>track.unitId==='raven')!.frames
    expect(frames.at(-1)!.traveledDistance).toBeGreaterThan(48)
    expect(frames.at(-1)!.mode).toBe('recovered')
    expect(Math.hypot(frames[1].position[0]-frames[0].position[0],frames[1].position[1]-frames[0].position[1])).toBeCloseTo(FLIGHT_SPEED.recon*(frames[1].time-frames[0].time),5)
  })
  it('confirms an encountered fixed site after a fighter recovers',()=>{
    const initial=createMatch(7301),home=initial.world.friendlyTerritory.center,site:[number,number]=[home[0]+6,home[1]]
    const target:Asset={id:'fighter-spotted-radar',kind:'radar',position:site,intel:'unknown',confidence:0,health:100,maxHealth:100,hidden:true,struck:false}
    const route:Point[]=[home,site,home]
    const state={...initial,debugScenario:'fighter-recon' as const,enemyAssets:[target],squadrons:initial.squadrons.map(squadron=>({...squadron,sortieOrdered:squadron.id==='viper',...(squadron.id==='viper'?{mission:'transit' as const,route,routeIngress:route}:{})}))}
    const result=resolveRound(state),applied=applyRound(state,result)
    const observation=result.contactObservations.find(item=>item.targetId===target.id)!
    const frame=result.unitTracks.find(track=>track.unitId==='viper')!.frames.find(item=>item.time===observation.start)!
    expect(observation.source).toBe('visual')
    expect(Math.hypot(frame.position[0]-site[0],frame.position[1]-site[1])).toBeLessThanOrEqual(FIXED_ASSET_OBSERVATION_RANGE)
    expect(result.intelReports).toEqual([expect.objectContaining({observerId:'viper',assetId:target.id,recovered:true})])
    expect(applied.enemyAssets.find(asset=>asset.id===target.id)).toMatchObject({intel:'confirmed',hidden:false})
    expect(result.mappedAreas).toEqual([])
  })
  it('keeps world edges invisible while recovering recon terrain mapping',()=>{const match=onlyRaven(createMatch(7301)),result=resolveRound(match);expect(result.squadrons.find(squadron=>squadron.id==='raven')?.status).toBe('rtb');expect(result.mappedAreas.length).toBeGreaterThan(0);expect(result.mappedAreas.every(point=>point[0]>=match.world.bounds.minX&&point[0]<=match.world.bounds.maxX&&point[1]>=match.world.bounds.minZ&&point[1]<=match.world.bounds.maxZ)).toBe(true);expect(result.discoveredBoundaries).toEqual([]);expect(result.events.some(event=>event.title==='WORLD EDGE DISCOVERED')).toBe(false);const applied=applyRound(match,result);expect(applyRound(applied,result).discoveredBoundaries).toEqual(applied.discoveredBoundaries)})
  it('alerts on a weapon launch while recon continues without an RTB command',()=>{const initial=createMatch(7301),base=initial.world.friendlyTerritory.center,direction=base[1]>=0?-1:1,route:Point[]=[base,[base[0],base[1]+direction*9]],sam:Asset={id:'abort-sam',kind:'sam',position:[base[0],base[1]+direction*3],intel:'unknown',confidence:0,health:100,maxHealth:100,hidden:true,struck:false},match={...initial,enemyAssets:[sam],squadrons:initial.squadrons.map(squadron=>squadron.id==='raven'?{...squadron,mission:'search-area' as const,route,routeIngress:route}:{...squadron,aircraft:0,strength:0})},result=resolveRound(match);expect(result.threatAlerts?.some(alert=>alert.unitId==='raven'&&alert.kind==='sam-launch')).toBe(true);expect(result.behaviorIntervals.some(interval=>interval.unitId==='raven'&&interval.reason==='air-defense-launch')).toBe(false)})
  it('drops provisional terrain mapping when recon is destroyed',()=>{const baseMatch=onlyRaven(createMatch(7301)),route=edgeRoute(baseMatch),[base]=route;const defenses:Asset[]=Array.from({length:8},(_,index)=>({id:`loss-sam-${index}`,kind:'sam',position:[base[0],base[1]+(base[1]>=0?-1:1)*(1.1+index*.05)] as Point,intel:'unknown',confidence:0,health:100,maxHealth:100,hidden:true,struck:false}));const match={...baseMatch,enemyAssets:defenses,squadrons:baseMatch.squadrons.map(squadron=>squadron.id==='raven'?{...squadron,aircraft:1,maxAircraft:1,strength:1}:squadron)},result=resolveRound(match);expect(result.squadrons.find(squadron=>squadron.id==='raven')?.status).toBe('destroyed');expect(result.mappedAreas).toEqual([]);expect(result.discoveredBoundaries).toEqual([])})
  it('persists a newly observed fixed asset only after recon recovers',()=>{const initial=createMatch(7301),base=initial.world.friendlyTerritory.center,position=[base[0],base[1]-5] as Point,target:Asset={id:'new-radar',kind:'radar',position,intel:'unknown',confidence:0,health:100,maxHealth:100,hidden:true,struck:false},route:[Point,Point,Point]=[base,position,base],match={...initial,enemyAssets:[target],squadrons:initial.squadrons.map(squadron=>squadron.id==='raven'?{...squadron,mission:'search-area' as const,route,routeIngress:route}:{...squadron,aircraft:0,strength:0})},result=resolveRound(match),applied=applyRound(match,result);expect(result.squadrons.find(squadron=>squadron.id==='raven')?.status).toBe('rtb');expect(result.intelReports).toEqual([expect.objectContaining({assetId:'new-radar',recovered:true})]);expect(applied.enemyAssets.find(asset=>asset.id==='new-radar')).toMatchObject({intel:'confirmed',hidden:false})})
  it('does not repeat an already-known asset in the after-action intelligence report',()=>{const initial=createMatch(7301),base=initial.world.friendlyTerritory.center,position=[base[0],base[1] - 4] as Point,known:Asset={id:'known-radar',kind:'radar',position,intel:'confirmed',confidence:90,health:100,maxHealth:100,hidden:false,struck:false},route:[Point,Point,Point]=[base,position,base],match={...initial,enemyAssets:[known],squadrons:initial.squadrons.map(squadron=>squadron.id==='raven'?{...squadron,route,routeIngress:route}:{...squadron,aircraft:0,strength:0})},result=resolveRound(match);expect(result.intelReports).toEqual([]);expect(result.intelGained).toEqual([])})
})
