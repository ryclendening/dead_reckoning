import { describe, expect, it } from 'vitest'
import { CAMPAIGN_ROUND_LIMIT } from './campaign'
import { FORMATION_PRICES, LOGISTICS_EFFECTS } from './economyRules'
import { createMatch } from './data'
import { projectOnlineGroundReplay } from './executionProjection'
import { resolveOnlineRound } from './onlineSimulation'
import { coverageSurveyFor } from './defenseIntel'
import { RADAR_BASE_RANGE } from './equipmentRules'
import type { MatchState, Point } from './types'

function seat(seed: number, offset = 0): MatchState {
  const match = createMatch(seed, 'easy', false)
  const base = match.playerAssets.find(asset => asset.kind === 'base')!
  const dx = offset
  const playerAssets = match.playerAssets.map(asset => ({ ...asset, position: [asset.position[0] + dx, asset.position[1]] as [number, number] }))
  const home = playerAssets.find(asset => asset.kind === 'base')!
  const enemyAssets = match.enemyAssets.map(asset => ({ ...asset, id: `opponent:${asset.id.replace(/^e-/, 'p-')}` }))
  return {
    ...match, cpu: undefined, phase: 'plan', world: { ...match.world, friendlyTerritory: { ...match.world.friendlyTerritory, center: [...home.position] } },
    playerAssets, playerBaseHealth: base.health, enemyAssets, enemyBaseHealth: 100,
    squadrons: match.squadrons.map(squadron => ({ ...squadron, sortieOrdered: false, plannedRecoveryFieldId: undefined })),
  }
}

describe('authoritative online round adapter', () => {
  it('remaps confirmed bomber targets for both seats and limits incoming impact replay to the owned site', () => {
    const a=seat(310),b=seat(311,8)
    const prepare=(state:MatchState,homePosition:Point,targetPosition:Point,enemyTargets:MatchState['playerAssets'])=>{
      const home=state.playerAssets.find(asset=>asset.kind==='base')!
      const sam=state.playerAssets.find(asset=>asset.kind==='sam')!
      state.playerAssets=[{...home,position:homePosition},{...sam,position:targetPosition}]
      state.enemyAssets=enemyTargets.map(asset=>({...asset,id:`opponent:${asset.id}`,intel:'confirmed' as const,confidence:100,hidden:false}))
      const source=state.squadrons[0]
      const targetId='opponent:p-sam'
      const target=state.enemyAssets.find(asset=>asset.id===targetId)!
      const route:Point[]=[homePosition,target.position,homePosition]
      const bomber={...source,id:`${homePosition[0]<0?'a':'b'}-bomber`,callsign:'BOMBER',
        role:'bomber' as const,aircraftTypeId:'bomber',mission:'bomb' as const,route,routeIngress:route,sortieOrdered:true,plannedRecoveryFieldId:'p-base',
        bombingTargets:[{targetId,routeIndex:1}]}
      const bomberTwo={...bomber,id:`${homePosition[0]<0?'a':'b'}-bomber-2`,callsign:'BOMBER 2'}
      state.squadrons=[bomber,bomberTwo,...state.squadrons.slice(1).map(formation=>({...formation,sortieOrdered:false}))]
      return state
    }
    const aTargets=b.playerAssets.map(asset=>({...asset,position:asset.kind==='base'?[6,0] as Point:asset.kind==='sam'?[3,0] as Point:asset.position}))
    const bTargets=a.playerAssets.map(asset=>({...asset,position:asset.kind==='base'?[-6,0] as Point:asset.kind==='sam'?[-3,0] as Point:asset.position}))
    const [resolvedA,resolvedB]=resolveOnlineRound([
      prepare(a,[-6,0],[ -3,0],aTargets),prepare(b,[6,0],[3,0],bTargets),
    ],77)
    for(const resolved of [resolvedA,resolvedB]){
      const impacts=resolved.lastResult!.weaponEffects.filter(effect=>effect.kind==='bomb')
      expect(impacts.some(effect=>effect.targetId==='opponent:p-sam'&&effect.sourceId.endsWith('-bomber'))).toBe(true)
      expect(impacts.some(effect=>effect.targetId==='p-sam')).toBe(true)
      expect(impacts.every(effect=>effect.targetId==='p-sam'||effect.targetId==='opponent:p-sam')).toBe(true)
      expect(impacts.every(effect=>!effect.sourceId.startsWith('red-'))).toBe(true)
      expect(resolved.lastResult!.logisticsIncome.objectives).toMatchObject([{ id: 'suppress-battery', amount: 4 }])
      expect(resolved.economy.completedObjectives).toContain('suppress-battery')
    }
    const incoming=resolvedA.lastResult!.weaponEffects.find(effect=>effect.kind==='bomb'&&effect.targetId==='p-sam'&&effect.sourceId==='hostile-aircraft')
    if(incoming)expect(incoming.from).toEqual(incoming.to)
    const hiddenImpactIds=resolvedA.lastResult!.weaponEffects.filter(effect=>effect.kind==='bomb'&&effect.targetId==='p-sam'&&effect.sourceId==='hostile-aircraft').map(effect=>effect.id)
    expect(hiddenImpactIds).toHaveLength(2)
    expect(new Set(hiddenImpactIds).size).toBe(2)
    expect(resolvedA.enemyAssets.find(asset=>asset.id==='opponent:p-sam')?.health).toBeLessThan(100)
  })

  it.each([0, 1] as const)('keeps coverage stale until a Survey Pod flight recovers for online seat %i', owner => {
    const prepare = (flight: 'fighter' | 'recon' | 'pod', prior: 'existing' | 'upgraded' | 'unknown' = 'existing') => {
      const states: [MatchState, MatchState] = [seat(50), seat(51)]
      const homes: [Point, Point] = [[-8, 0], [8, 0]]
      for (const [index, state] of states.entries()) {
        const home = homes[index]
        const radar = state.playerAssets.find(asset => asset.kind === 'radar')!
        state.round = 3
        state.playerAssets = [
          { ...state.playerAssets.find(asset => asset.kind === 'base')!, position: home },
          { ...radar, position: [home[0], 1], upgrades: ['wide-scan'] },
        ]
        state.enemyAssets = [{
          ...radar, id: 'opponent:p-radar', position: [homes[1 - index][0], 1],
          intel: 'confirmed', confidence: 90, hidden: false,
          defenseSurvey: prior === 'upgraded' ? { round: 2, range: 8, upgrades: ['wide-scan'] } : { round: 1, range: RADAR_BASE_RANGE, upgrades: [] },
        }]
        if (prior === 'unknown') state.enemyAssets = []
        if (prior === 'upgraded') state.economy.completedObjectives = ['survey-upgrade']
        if (index !== owner) continue
        const route: Point[] = [home, [homes[1 - owner][0], 1]]
        const id = flight === 'fighter' ? 'viper' : 'raven'
        state.squadrons = state.squadrons.map(formation => formation.id !== id ? formation : {
          ...formation, mission: flight === 'fighter' ? 'transit' : 'search-area', route, routeIngress: route,
          upgrades: flight === 'pod' ? ['survey-pod'] : [],
          sortieOrdered: true, plannedRecoveryFieldId: 'p-base',
        })
      }
      return states
    }
    const radarOf = (match: MatchState) => match.enemyAssets.find(asset => asset.kind === 'radar')!
    for (const flight of ['fighter', 'recon'] as const) {
      const result = resolveOnlineRound(prepare(flight), 56)[owner]
      expect(coverageSurveyFor(radarOf(result))).toEqual({ round: 1, range: RADAR_BASE_RANGE })
      expect(radarOf(result).upgrades ?? []).not.toContain('wide-scan')
      expect(result.lastResult?.logisticsIncome.objectives).toBeUndefined()
    }

    const standardRecon = resolveOnlineRound(prepare('recon', 'unknown'), 56)[owner]
    expect(radarOf(standardRecon)).toMatchObject({ intel: 'confirmed', hidden: false })
    expect(coverageSurveyFor(radarOf(standardRecon))).toBeUndefined()
    expect(standardRecon.lastResult?.groundReplay?.enemySightings.map(item => item.asset.kind)).toContain('radar')
    expect(standardRecon.lastResult?.groundReplay?.enemySightings.every(item => !item.asset.upgrades && !item.asset.defenseSurvey)).toBe(true)

    const byPod = resolveOnlineRound(prepare('pod'), 56)[owner]
    expect(radarOf(byPod).defenseSurvey).toEqual({ round: 3, range: 8, upgrades: ['wide-scan'] })
    expect(coverageSurveyFor(radarOf(byPod))).toEqual({ round: 3, range: 8 })
    expect(byPod.lastResult?.groundReplay?.knownEnemyAtStart[0].defenseSurvey?.round).toBe(1)
    expect(byPod.lastResult?.logisticsIncome.objectives).toMatchObject([{ id: 'survey-upgrade', amount: 3 }])
    expect(byPod.economy.completedObjectives).toContain('survey-upgrade')

    const seenAgain = resolveOnlineRound(prepare('pod', 'upgraded'), 56)[owner]
    expect(coverageSurveyFor(radarOf(seenAgain))).toEqual({ round: 3, range: 8 })
    expect(seenAgain.lastResult?.logisticsIncome.objectives).toBeUndefined()
  })

  it('shows observed ground sites and their HP to both seats only when their own recon sees them', () => {
    const prepare = (state: MatchState, x: number) => {
      const home: Point = [x, 0]
      const route: Point[] = [home, [-x, 0], home]
      state.enemyAssets = []
      state.playerAssets = state.playerAssets.flatMap(asset => {
        if (asset.kind === 'base') return [{ ...asset, position: home, health: 84 }]
        if (asset.kind === 'radar') return [{ ...asset, position: [x, 1] as Point, health: 47 }]
        if (asset.kind === 'aaa') return [{ ...asset, position: [x, 10] as Point }]
        return []
      })
      state.squadrons = state.squadrons.map(formation => formation.id==='raven'
        ? {...formation,sortieOrdered:true,mission:'search-area',route,routeIngress:route,plannedRecoveryFieldId:'p-base'}
        : formation)
      return state
    }
    const seats=resolveOnlineRound([prepare(seat(120),-7),prepare(seat(121),7)],39)
    for(const state of seats){
      const result=state.lastResult!
      expect(projectOnlineGroundReplay(result,0)?.enemyAssets).toEqual([])
      expect(projectOnlineGroundReplay(result,0)?.playerAssets.find(asset=>asset.kind==='base')?.health).toBe(84)
      const radar=result.groundReplay!.enemySightings.find(sighting=>sighting.asset.kind==='radar')!
      const observer=result.unitTracks.find(track=>track.unitId==='raven')!.frames.find(frame=>Math.abs(frame.time-radar.start)<1e-6)!
      expect(Math.hypot(observer.position[0]-radar.asset.position[0],observer.position[1]-radar.asset.position[1]))
        .toBeGreaterThan(RADAR_BASE_RANGE)
      expect(projectOnlineGroundReplay(result,radar.start)?.enemyAssets.find(asset=>asset.id==='opponent:p-radar')).toMatchObject({health:47,intel:'probable'})
      expect(projectOnlineGroundReplay(result,result.duration)?.enemyAssets).toEqual([])
      expect(state.enemyAssets.find(asset=>asset.id==='opponent:p-radar'), JSON.stringify({recovery:result.recoveryOutcomes,assets:state.enemyAssets})).toMatchObject({health:47,intel:'confirmed'})
      expect(result.groundReplay!.enemySightings.some(sighting=>sighting.asset.kind==='aaa')).toBe(false)
    }
  })

  it('resolves once into self-oriented settled replays without exposing hidden opponent deployment', () => {
    const a = seat(137, 0), b = seat(841, 8)
    const [resolvedA, resolvedB] = resolveOnlineRound([a, b], 991)

    expect(resolvedA.phase).toBe('debrief')
    expect(resolvedB.phase).toBe('debrief')
    expect(resolvedA.lastResult?.round).toBe(a.round)
    expect(resolvedB.lastResult?.round).toBe(b.round)
    expect(resolvedA.squadrons.map(item => item.id)).toEqual(a.squadrons.map(item => item.id))
    expect(resolvedB.squadrons.map(item => item.id)).toEqual(b.squadrons.map(item => item.id))
    expect(resolvedA.lastResult?.cpuReport).toBeUndefined()
    expect(resolvedB.lastResult?.cpuReport).toBeUndefined()
    expect(resolvedA.lastResult?.assets).toEqual([])
    expect(resolvedB.lastResult?.assets).toEqual([])
    expect(resolvedA.lastResult?.enemyFlights).toEqual([])
    expect(resolvedB.lastResult?.enemyFlights).toEqual([])
    expect(resolvedA.lastResult?.unitTracks.every(track => a.squadrons.some(item => item.id === track.unitId))).toBe(true)
    expect(resolvedB.lastResult?.unitTracks.every(track => b.squadrons.some(item => item.id === track.unitId))).toBe(true)
    expect(resolvedA.playerAssets.map(asset => asset.position)).toEqual(a.playerAssets.map(asset => asset.position))
    expect(resolvedB.playerAssets.map(asset => asset.position)).toEqual(b.playerAssets.map(asset => asset.position))
    expect(resolvedA.logistics).toBeGreaterThan(a.logistics)
    expect(resolvedB.logistics).toBeGreaterThan(b.logistics)
  })

  it('is deterministic and keeps opponent identifiers namespaced in authorized contacts', () => {
    const a = seat(201), b = seat(802, 8)
    const first = resolveOnlineRound([a, b], 42)
    const second = resolveOnlineRound([a, b], 42)
    expect(first).toEqual(second)
    for (const state of first) {
      expect(state.lastResult?.contactIntervals.every(interval => interval.targetId.startsWith('opponent:'))).toBe(true)
      expect(state.lastResult?.unitTracks.filter(track => track.unitId.startsWith('opponent:')).every(track =>
        state.lastResult?.contactIntervals.some(interval => interval.targetId === track.unitId))).toBe(true)
    }
  })

  it('flies the locked return waypoints for both seats', () => {
    const prepare = (state: MatchState, x: number) => {
      const home: Point = [x, 0]
      const route: Point[] = [home, [x, 4]]
      const returnPoint: Point = [x * .8, 2]
      state.playerAssets = state.playerAssets.filter(asset => asset.kind === 'base').map(base => ({ ...base, position: home }))
      state.squadrons = state.squadrons.map(formation => formation.id === 'raven'
        ? { ...formation, mission: 'search-area', sortieOrdered: true, plannedRecoveryFieldId: 'p-base', route, routeIngress: route, recoveryWaypoints: [returnPoint] }
        : formation)
      return { state, returnPoint }
    }
    const prepared = [prepare(seat(137), -8), prepare(seat(841), 8)] as const
    const resolved = resolveOnlineRound([prepared[0].state, prepared[1].state], 991)
    for (const [i, match] of resolved.entries()) {
      const frames = match.lastResult!.unitTracks.find(track => track.unitId === 'raven')!.frames
      const [x,y] = prepared[i].returnPoint
      expect(frames.some(frame => frame.mode === 'recovering' && frame.position[0] === x && frame.position[1] === y)).toBe(true)
      expect(frames.at(-1)?.mode).toBe('recovered')
    }
  })

  it('applies both base strikes once and reports a simultaneous-destruction draw from both seats', () => {
    const first = seat(333), second = seat(444, 8)
    const aBase = first.playerAssets.find(asset => asset.kind === 'base')!
    const bBase = second.playerAssets.find(asset => asset.kind === 'base')!
    aBase.health = 40
    bBase.health = 40
    aBase.position = [-4, 0]
    bBase.position = [4, 0]
    const prepare = (state: MatchState, launch: typeof aBase, target: typeof bBase): MatchState => ({
      ...state,
      playerAssets: [launch],
      enemyAssets: [{ ...target, id: 'opponent:p-base' }],
      squadrons: state.squadrons.map((squadron, index) => index === 0 ? {
        ...squadron, mission: 'base-strike', sortieOrdered: true,
        strikeTargetId: 'opponent:p-base', plannedRecoveryFieldId: 'p-base',
        route: [launch.position, [launch.position[0] * .5, 0]], routeIngress: [launch.position, [launch.position[0] * .5, 0]],
      } : squadron),
    })
    const pair = resolveOnlineRound([prepare(first, aBase, bBase), prepare(second, bBase, aBase)], 71)
    for (const state of pair) {
      expect(state.onlineOutcome).toBe('mutual-destruction')
      expect(state.playerBaseHealth).toBe(0)
      expect(state.lastResult?.baseDamage).toBe(40)
      expect(state.lastResult?.enemyBaseDamage).toBe(40)
      expect(state.lastResult?.combatSequences.filter(sequence => sequence.kind === 'strike')).toHaveLength(2)
      const result=state.lastResult!
      const impact=result.combatSequences.flatMap(sequence=>sequence.exchanges).find(shot=>shot.defenderId==='p-base')!
      expect(projectOnlineGroundReplay(result,impact.time-.05)?.playerAssets[0].health).toBe(40)
      expect(projectOnlineGroundReplay(result,impact.time)?.playerAssets[0].health).toBe(0)
      expect(projectOnlineGroundReplay(result,result.duration)?.enemyAssets[0].health).toBe(0)
    }
  })

  it.each([0,1])('joins a passing PvP Transit fighter from seat %i to an existing dogfight', lateSeat => {
    const prepare = (state: MatchState, x: number, sendWingman: boolean): MatchState => {
      const home: Point = [x, 0]
      const primaryRoute: Point[] = [home, [-x, 0]]
      const wingRoute: Point[] = [home, [x * .65, 3], [0, 0], [-x, 0]]
      return {
        ...state,
        playerAssets: state.playerAssets.filter(asset => asset.kind === 'base').map(base => ({...base, position:home})),
        enemyAssets: [],
        squadrons: state.squadrons.map(formation => {
          if (formation.id !== 'viper' && !(sendWingman && formation.id === 'falcon')) return formation
          const route = formation.id === 'viper' ? primaryRoute : wingRoute
          return { ...formation, mission:'transit', sortieOrdered:true, plannedRecoveryFieldId:'p-base', route, routeIngress:route }
        }),
      }
    }
    const a = prepare(seat(333), -8, lateSeat===0)
    const b = prepare(seat(444), 8, lateSeat===1)
    const result = resolveOnlineRound([a,b], 71)[lateSeat].lastResult!
    const fight = result.combatSequences.find(sequence => sequence.kind==='dogfight')
    const arrival = fight?.engagement?.participants.find(participant => participant.id==='falcon')
    expect(arrival?.joinedAt).toBeGreaterThan(fight!.start)
    expect(result.unitTracks.find(track => track.unitId==='falcon')?.frames.filter(frame => frame.time<arrival!.joinedAt).at(-1)?.mode).toBe('following-route')
    expect(fight?.engagement?.sides.friendly).toEqual(expect.arrayContaining(['viper','falcon']))
  })

  it('shows own AAA muzzle flashes without disclosing an untracked target', () => {
    const a = seat(137)
    const b = seat(841)
    a.enemyAssets = []
    b.enemyAssets = []
    a.playerAssets = a.playerAssets.flatMap(asset => asset.kind === 'base' || asset.kind === 'aaa'
      ? [{ ...asset, position: [0, 0] as Point }] : [])
    b.playerAssets = b.playerAssets.filter(asset => asset.kind === 'base').map(asset => ({ ...asset, position: [7, 0] }))
    const route: Point[] = [[7, 0], [0, 0]]
    b.squadrons = b.squadrons.map(formation => formation.id === 'raven'
      ? { ...formation, mission: 'search-area', route, routeIngress: route, sortieOrdered: true, plannedRecoveryFieldId: 'p-base' }
      : formation)
    const [resolved] = resolveOnlineRound([a,b],991)
    const result = resolved.lastResult!
    expect(result.enemyFlights).toEqual([])
    const launches = result.weaponEffects.filter(effect => effect.kind === 'aaa')
    expect(launches).toHaveLength(5)
    for (const launch of launches) expect(launch).toMatchObject({
      sourceId: 'p-aaa', targetId: 'untracked-aircraft', from: [0,0], to: [0,0], launchOnly: true, hit: false, damage: 0,
    })
  })

  it('continues and pays ground-only sides through the deadline', () => {
    const a = seat(137), b = seat(841, 8)
    const lost = { ...a, logistics: FORMATION_PRICES.recon - LOGISTICS_EFFECTS.baseIncome, squadrons:a.squadrons.map(formation => ({ ...formation, aircraft:0, strength:0 })) }
    const eligible = resolveOnlineRound([lost,b], 991)
    expect(eligible[0].logistics).toBe(FORMATION_PRICES.recon)
    expect(eligible.every(state => state.onlineOutcome === undefined)).toBe(true)
    const broke = resolveOnlineRound([{...lost, logistics:lost.logistics-1},b], 991)
    expect(broke.every(state => state.onlineOutcome === undefined)).toBe(true)
    const final = resolveOnlineRound([{...lost,round:CAMPAIGN_ROUND_LIMIT},{...b,round:CAMPAIGN_ROUND_LIMIT}], 991)
    expect(final.map(state => state.onlineOutcome)).toEqual(['deadline','deadline'])
  })

  it('publishes only contact-window slices of an opponent route', () => {
    const a = seat(333), b = seat(444, 8)
    const aBase = a.playerAssets.find(asset => asset.kind === 'base')!.position
    const bBase = b.playerAssets.find(asset => asset.kind === 'base')!.position
    const sendThroughCenter = (state: MatchState, destination: [number, number]) => ({
      ...state, squadrons: state.squadrons.map((squadron, index) => index !== 0 ? squadron : {
        ...squadron, mission: 'transit' as const, sortieOrdered: true, plannedRecoveryFieldId: 'p-base',
        route: [state.playerAssets.find(asset => asset.kind === 'base')!.position, destination],
        routeIngress: [state.playerAssets.find(asset => asset.kind === 'base')!.position, destination],
      }),
    })
    const aOrders = sendThroughCenter(a, bBase)
    const bOrders = sendThroughCenter(b, aBase)
    const [resolvedA, resolvedB] = resolveOnlineRound([aOrders, bOrders], 71)

    const seenByA = resolvedA.lastResult!.contactIntervals.filter(interval => interval.targetId.startsWith('opponent:track-'))
    const seenByB = resolvedB.lastResult!.contactIntervals.filter(interval => interval.targetId.startsWith('opponent:track-'))
    expect(seenByA.length).toBeGreaterThan(0)
    expect(seenByB.length).toBeGreaterThan(0)
    for (const [state, windows] of [[resolvedA, seenByA], [resolvedB, seenByB]] as const) {
      const hostile = state.lastResult!.unitTracks.find(track => track.unitId === windows[0].targetId)
      expect(hostile).toBeDefined()
      expect(hostile!.frames.length).toBeLessThan(state.lastResult!.duration / state.lastResult!.tickSeconds)
      expect(hostile!.frames.every(frame => windows.some(window => frame.time >= window.start - .001 && frame.time <= window.end + .001))).toBe(true)
      const flight = state.lastResult!.enemyFlights.find(item => item.id === hostile!.unitId)
      expect(flight?.route).toEqual(hostile!.frames.map(frame => frame.position))
      expect(flight).not.toHaveProperty('reconPosture')
      expect(flight).not.toHaveProperty('routeIngress')
      expect(flight).not.toHaveProperty('recoveryWaypoints')
    }

    const groundedB = { ...b, squadrons: b.squadrons.map(squadron => ({ ...squadron, sortieOrdered: false })) }
    const [, radarReplay] = resolveOnlineRound([aOrders, groundedB], 72)
    expect(radarReplay.lastResult!.contactIntervals.some(interval => interval.observerId === 'p-radar' &&
      interval.targetId.startsWith('opponent:track-') && interval.source === 'radar')).toBe(true)
    expect(radarReplay.lastResult?.events.find(event => event.title === 'SORTIES AIRBORNE')?.detail).toBe('0 aircraft committed.')
    expect(radarReplay.lastResult?.enemyFlights.every(flight => flight.callsign === 'UNKNOWN AIRCRAFT')).toBe(true)
  })
})
