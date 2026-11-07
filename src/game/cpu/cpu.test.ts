import { describe, expect, it } from 'vitest'
import { createMatch } from '../data'
import { campaignOutcome } from '../campaign'
import { applyRound, resolveRound } from '../engine'
import { beginNextRound, openAdaptPhase } from '../economy'
import { aircraftAtStrength, missionDistance } from '../flightRules'
import { normalizeMatch } from '../persistence'
import { cpuPlanningView, cpuReportAt, cpuRouteRisk, planCpu, prepareCpuRound } from './planner'
import { strikeOrders } from './routes'
import { maintainCpu, settleCpuRound } from './settlement'
import type { CpuDifficulty, CpuSiteReport } from './types'

function view(difficulty: CpuDifficulty = 'medium') {
  const state = createMatch(7301, difficulty)
  return cpuPlanningView(state)!
}

describe('CPU campaign planning', () => {
  it('freezes orders before player planning, and hidden player changes cannot affect a fresh planning view', () => {
    const state = createMatch(), changed = structuredClone(state)
    changed.playerAssets.forEach(asset => { asset.position = [300, 400]; asset.health = 1 })
    changed.squadrons.forEach(unit => { unit.route = [[900, 900], [800, 800]]; unit.mission = 'transit' })
    changed.world.bounds = { minX: -900, maxX: 900, minZ: -800, maxZ: 800 }
    changed.logistics = 10000
    changed.mappedAreas = [[800,900]]; changed.world.friendlyTerritory={center:[800,900],radius:100}
    changed.enemyAssets.forEach(a=>{a.intel='confirmed';a.hidden=false;a.confidence=100})
    expect(cpuPlanningView(changed)).toEqual(cpuPlanningView(state))
    expect(planCpu(cpuPlanningView(changed)!)).toEqual(planCpu(cpuPlanningView(state)!))
    expect(prepareCpuRound(changed)).toBe(changed)
    expect(changed.cpu!.plan).toEqual(state.cpu!.plan)
  })

  it('changes from patrol to home defense after its own base is damaged', () => {
    const initial = view()
    initial.cpu.traffic = []; initial.cpu.lastReconLost = false
    expect(planCpu(initial).intent).toBe('discover')
    expect(planCpu({ ...initial, homeHealth: 30 }).intent).toBe('protect-base')
  })

  it('requires recovered confirmation and the same base-pressure gate on every difficulty', () => {
    for (const difficulty of ['easy', 'medium', 'hard'] as const) {
      const initial = view(difficulty), report: CpuSiteReport = { id: 'p-base', kind: 'base', position: [0, 0], health: 100, maxHealth: 100, observedRound: 1 }
      expect(planCpu({ ...initial, exposure: 100 }).orders.some(order => order.strikeTargetId)).toBe(false)
      initial.cpu.sites = [report]
      expect(planCpu({ ...initial, exposure: 59 }).orders.some(order => order.strikeTargetId)).toBe(false)
      expect(planCpu({ ...initial, exposure: 60 }).orders.find(order => order.role === 'fighter')?.strikeTargetId).toBe('p-base')
    }
  })

  it('uses extra Hard route candidates to reduce known SAM exposure', () => {
    const easy = view('easy'), hard = view('hard')
    const sites: CpuSiteReport[] = [
      { id: 'p-base', kind: 'base', position: [0, 0], health: 30, maxHealth: 100, observedRound: 1 },
      { id: 'p-sam', kind: 'sam', position: [easy.home[0] * .65, easy.home[1] * .65], health: 100, maxHealth: 100, observedRound: 1 },
    ]
    easy.cpu.sites = sites; hard.cpu.sites = sites; easy.exposure = hard.exposure = 60
    const easyPlan = planCpu(easy), hardPlan = planCpu(hard)
    const risk = (v: typeof easy, p: typeof easyPlan) => cpuRouteRisk([...p.orders[0].route, v.home], 'fighter', sites)
    expect(risk(hard, hardPlan)).toBeLessThan(risk(easy, easyPlan))
  })

  it.each([[1, 0], [-1, 0], [0, 1], [0, -1]])('keeps an already-near target inside release range in direction %s,%s', (x, z) => {
    const initial = view()
    const position: [number, number] = [initial.home[0] + x * 5.99, initial.home[1] + z * 5.99]
    initial.cpu.sites = [{ id: 'near-sam', kind: 'sam', position, health: 100, maxHealth: 100, observedRound: 1 }]
    const fighter = strikeOrders(initial,initial.cpu.formations[0],initial.cpu.sites[0],{expansions:0,rejected:[]})[0], release = fighter.route.at(-1)!
    expect(fighter.strikeTargetId).toBe('near-sam')
    expect(Math.hypot(release[0] - position[0], release[1] - position[1])).toBeLessThanOrEqual(6)
    expect(release).not.toEqual(initial.home)
  })

  it('keeps every generated order in range across seeds, difficulties and damaged home states', () => {
    for (const difficulty of ['easy', 'medium', 'hard'] as const) for (let seed = 1; seed <= 12; seed++) {
      const initial = cpuPlanningView(createMatch(seed, difficulty))!
      for (const health of [100, 30]) for (const order of planCpu({ ...initial, homeHealth: health }).orders) {
        expect(missionDistance(order.route, initial.home)).toBeLessThanOrEqual(order.role === 'fighter' ? 40.001 : 64.001)
      }
    }
  })

  it('does not invent fighter opposition or force escort after an unexplained recon loss', () => {
    const initial = view('hard')
    initial.cpu.lastReconLost = true
    const plan = planCpu(initial)
    expect(plan.orders[0].protectedTargetId).toBeUndefined()
    expect(missionDistance(plan.orders[1].route, initial.home)).toBeLessThanOrEqual(48.001)
  })
})

describe('CPU execution and persistence', () => {
  it('commits a recovered fighter sighting to CPU site knowledge and base exposure', () => {
    const initial=createMatch(7301,'hard'),home=initial.enemyAssets.find(asset=>asset.kind==='base')!.position
    const playerBase=initial.playerAssets.find(asset=>asset.kind==='base')!
    const position:[number,number]=[home[0]+(home[0]>=0?-6:6),home[1]]
    const route:[number,number][]=[home,position,home]
    const orders=initial.cpu!.plan!.orders.map(order=>order.role==='fighter'?{...order,mission:'transit' as const,route,routeIngress:route,sortieOrdered:true}:{...order,sortieOrdered:false})
    const state={...initial,baseExposure:26,playerAssets:[{...playerBase,position}],squadrons:initial.squadrons.map(squadron=>({...squadron,sortieOrdered:false})),cpu:{...initial.cpu!,plan:{...initial.cpu!.plan!,orders}}}
    const result=resolveRound(state),settled=applyRound(state,result)
    expect(result.baseDamage).toBe(0)
    expect(result.baseExposureDelta).toBe(40)
    expect(result.cpuReport?.recoveredIds).toContain('red-fighter')
    expect(result.cpuReport?.sites).toContainEqual(expect.objectContaining({id:playerBase.id,position}))
    expect(settled.cpu?.sites).toContainEqual(expect.objectContaining({id:playerBase.id,position}))
  })
  it('commits site reports only from surviving recon and preserves losses through settlement and reload', () => {
    const initial = createMatch(), result = resolveRound(initial), next = applyRound(initial, result)
    expect(result.cpuReport).toBeDefined()
    expect(next.cpu!.sites).toEqual(result.cpuReport!.sites)
    for (const formation of next.cpu!.formations) {
      const recovered = result.cpuReport!.recoveredIds.includes(formation.id)
      expect(formation.aircraft).toBe(recovered ? result.enemyFlights.find(f => f.id === formation.id)!.aircraft : 0)
    }
    expect(applyRound(next, result)).toBe(next)
    const restored = normalizeMatch(JSON.parse(JSON.stringify(next)))
    expect(restored.cpu).toEqual(next.cpu)
    expect(restored.phase).toBe('debrief')
  })

  it('a lost sortie cannot contribute its provisional site observations', () => {
    let initial = createMatch()
    const home = initial.enemyAssets.find(a => a.kind === 'base')!.position
    const sam = initial.playerAssets.find(a => a.kind === 'sam')!
    initial = { ...initial, playerAssets: [initial.playerAssets.find(a => a.kind === 'base')!, ...Array.from({ length: 6 }, (_, i) => ({ ...sam, id: `fixture-sam-${i}`, position: home }))],
      squadrons: initial.squadrons.map(s => ({ ...s, sortieOrdered: false })) }
    initial.cpu!.plan!.orders[0].sortieOrdered = false
    const result = resolveRound(initial)
    expect(result.enemyFlights.find(f => f.id === 'red-recon')!.aircraft).toBe(0)
    expect(result.cpuReport!.sites).toEqual([])
    const settled = settleCpuRound(initial, result)
    expect(settled.cpu!.sites).toEqual([])
    expect(settled.cpu!.formations.find(f => f.role === 'recon')!.aircraft).toBe(0)
    expect(settleCpuRound(settled, result)).toBe(settled)
  })

  it('keeps CPU radar receipts private while allowing its defender to act on them', () => {
    let state = createMatch()
    const home = state.enemyAssets.find(a => a.kind === 'base')!.position, launch: [number, number] = [home[0], home[1] + 4.45]
    state = { ...state, enemyAssets: state.enemyAssets.map(a => a.kind === 'base' ? { ...a, health: 40 } : a),
      playerAssets: state.playerAssets.filter(a => a.kind === 'base').map(a => ({ ...a, position: launch })),
      squadrons: state.squadrons.map(s => ({ ...s, sortieOrdered: s.role === 'recon', route: [launch, launch], routeIngress: [launch, launch] })), cpu: { ...state.cpu!, plan: undefined } }
    state.enemyAssets = state.enemyAssets.map(a => a.kind === 'radar' ? { ...a, position: home } : a)
    state = prepareCpuRound(state)
    const result = resolveRound(state)
    expect(result.interceptPlans.some(p => p.squadronId === 'red-fighter' && p.source === 'radar')).toBe(true)
    expect(result.contactIntervals.some(c => c.observerId.startsWith('e-') || c.observerId.startsWith('red-'))).toBe(false)
    expect(result.events.some(e => e.title === 'FIGHTER INTERCEPT' && e.detail.includes('BOGEY'))).toBe(false)
  })

  it('honors a CPU recon recovery decision during an active pursuit', () => {
    let state = createMatch(7301, 'medium')
    const home = state.enemyAssets.find(a => a.kind === 'base')!.position
    state = { ...state, playerAssets: state.playerAssets.filter(a => a.kind === 'base').map(a => ({ ...a, position: home })),
      squadrons: state.squadrons.map(s => ({ ...s, sortieOrdered: s.id === 'viper', mission: s.role === 'fighter' ? 'forward-patrol' : 'search-area', route: [home, [home[0] + 6, home[1]]], routeIngress: [home, [home[0] + 6, home[1]]] })) }
    state.cpu!.plan!.orders[0].sortieOrdered = false
    const result = resolveRound(state)
    const recovery = result.behaviorIntervals.find(i => i.unitId === 'red-recon' && i.reason === 'cpu-preserve-recon')!
    expect(recovery).toBeDefined()
    expect(result.combatSequences.some(s => s.kind === 'pursuit' && s.start < recovery.start && s.participantIds.includes('red-recon'))).toBe(true)
    expect(result.cpuReport!.recoveredIds).toContain('red-recon')
  })

  it('CPU site strike reaches its release point and damages the selected support target at impact', () => {
    let state = createMatch(7301, 'hard')
    const home = state.enemyAssets.find(a => a.kind === 'base')!.position
    const target = { ...state.playerAssets.find(a => a.kind === 'radar')!, position: [home[0] + 5, home[1]] as [number, number] }
    state = { ...state, playerAssets: [state.playerAssets.find(a => a.kind === 'base')!, target], squadrons: state.squadrons.map(s => ({ ...s, sortieOrdered: false })),
      cpu: { ...state.cpu!, sites: [cpuReportAt(target, 1)], plan: undefined } }
    // A support strike is valuable late in the campaign when no base is confirmed.
    state.cpu!.sites[0].kind = 'sam'; target.kind = 'sam'
    state = prepareCpuRound(state)
    const order=strikeOrders(cpuPlanningView(state)!,state.cpu!.formations[0],state.cpu!.sites[0],{expansions:0,rejected:[]})[0]
    state.cpu!.plan!.orders[0]=order
    expect(order.strikeTargetId).toBe(target.id)
    const result = resolveRound(state)
    const missile = result.weaponEffects.find(effect => effect.sourceId === 'red-fighter' && effect.kind === 'air-to-ground-missile')
    expect(missile?.targetId).toBe(target.id)
    expect(missile?.from).toEqual(state.cpu!.plan!.orders[0].route.at(-1))
    expect(result.playerAssets.find(a => a.id === target.id)!.health).toBeLessThan(100)
    expect(result.baseDamage).toBe(0)
  })

  it('pays for maintenance once and uses proportional strength when replacing two-aircraft recon', () => {
    const state = createMatch(), cpu = structuredClone(state.cpu!)
    cpu.formations[1] = { ...cpu.formations[1], strength: 0, aircraft: 0 }
    cpu.logistics = 4; cpu.reserves = 1
    const adapted = maintainCpu({ ...state, phase: 'adapt', cpu })
    expect(adapted.cpu!.formations[1]).toMatchObject({ aircraft: 1, strength: 50 })
    expect(adapted.cpu!.logistics).toBe(0)
    expect(adapted.cpu!.reserves).toBe(0)
    expect(maintainCpu(adapted)).toBe(adapted)
    expect(aircraftAtStrength(50, 2)).toBe(1)
    expect(aircraftAtStrength(50, 4)).toBe(2)
  })

  it('migrates legacy campaigns once and rejects malformed CPU saves', () => {
    const saved = JSON.parse(JSON.stringify(createMatch(7301, 'hard')))
    expect(normalizeMatch(saved).cpu!.difficulty).toBe('hard')
    delete saved.cpu
    const migrated = normalizeMatch(saved)
    expect(migrated.cpu!.difficulty).toBe('medium')
    expect(normalizeMatch(JSON.parse(JSON.stringify(migrated))).cpu).toEqual(migrated.cpu)
    migrated.cpu!.formations[0].aircraft = 999
    expect(normalizeMatch(migrated).phase).toBe('deploy')
  })

  it('prepares the next plan once after settled recovery and maintenance', () => {
    const initial = createMatch(), settled = applyRound(initial, resolveRound(initial)), adapted = openAdaptPhase(settled)
    const next = beginNextRound(adapted)
    expect(next.round).toBe(2)
    expect(next.cpu!.plan!.round).toBe(2)
    expect(prepareCpuRound(next)).toBe(next)
    expect(normalizeMatch(JSON.parse(JSON.stringify(next))).cpu).toEqual(next.cpu)
  })

  it.each(['easy', 'medium', 'hard'] as const)('completes a %s recon-to-strike campaign using recovered evidence and saved orders', difficulty => {
    let state = createMatch(7301, difficulty)
    state = { ...state, playerAssets: state.playerAssets.filter(a => a.kind === 'base').map(a => ({ ...a, position: [0, 0] })),
      squadrons: state.squadrons.map(s => ({ ...s, sortieOrdered: false })) }
    for (let round = 1; round <= 6; round++) {
      state = normalizeMatch(JSON.parse(JSON.stringify(state)))
      const result = resolveRound(state)
      if (round === 1) {
        expect(result.cpuReport!.sites.some(site => site.kind === 'base')).toBe(true)
        expect(result.baseDamage).toBe(0)
        expect(result.baseExposureDelta).toBe(40)
      }
      if (round === 2) {
        expect(state.baseExposure).toBe(46)
        expect(result.baseDamage).toBe(0)
      }
      state = openAdaptPhase(applyRound(state, result))
      if (state.phase === 'defeat') break
      state = beginNextRound(state)
      state.squadrons = state.squadrons.map(s => ({ ...s, sortieOrdered: false }))
    }
    expect(campaignOutcome(state)).toBe('home-base-destroyed')
    expect(state.round).toBeLessThanOrEqual(6)
    expect(state.cpu!.sites.some(site => site.id === 'p-base')).toBe(true)
  })
})
