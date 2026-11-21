import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createMatch,enemyBaseFor } from '../game/data'
import {createRoundSimulation,resolveRound} from '../game/engine'
import {createScenario} from '../game/scenarios'
import type { Asset } from '../game/types'
import { TopBar, CommandShelf, ContactTracks, ExecutionChitRail, FormationDock } from './Hud'

describe('phase help in the match header', () => {
  it('puts the phase help behind a closed dialog and adds the multiplayer instructions for that phase', () => {
    const noop = () => {}
    const props = { round: 1, debugScenario: 'campaign' as const, onDebugScenario: noop, onReboot: noop, onMenu: noop }
    const deploy = renderToStaticMarkup(<TopBar {...props} phase="deploy" onlineStatus="PvP" />)
    const plan = renderToStaticMarkup(<TopBar {...props} phase="plan" />)

    expect(deploy).toContain('aria-label="Help for Deployment"')
    expect(deploy).toContain('Linked SAMs can fire anywhere inside')
    expect(deploy).toContain('after both players lock their deployments')
    expect(deploy).not.toMatch(/<dialog[^>]* open(?:=|>| )/)
    expect(plan).toContain('aria-label="Help for Planning"')
    expect(plan).toContain('Outbound travel, the mission pattern, and the return all use fuel')
    expect(plan).toContain('Bombers take up to three targets in tap order.')
    expect(plan).toContain('Hold a point and drag to size a Protect ring.')
    expect(plan).not.toContain('both players')
  })
})

describe('contact and recovery information',()=>{
  it('shows one unknown numbered report per radar contact without leaking aircraft type or count',()=>{
    const state=createScenario('radar-intercept')
    state.squadrons=state.squadrons.map(squadron=>({...squadron,sortieOrdered:false}))
    state.playerAssets=state.playerAssets.map(asset=>asset.kind==='radar'?{...asset,position:enemyBaseFor(state.world)}:asset)
    const simulation=createRoundSimulation(state);simulation.advance()
    const markup=renderToStaticMarkup(<ContactTracks result={simulation.result} seconds={simulation.result.duration} home={state.world.friendlyTerritory.center} onFocus={()=>{}}/>)
    expect(markup).toContain('TRACK 01 · UNKNOWN AIRCRAFT')
    expect(markup).not.toContain('MiG-23')
    expect(markup).not.toContain('BOGEY')
    expect(markup).not.toContain('FIGHTER')
    expect(markup).not.toContain('4 AIRCRAFT')
  })

  it('explains why a recon is returning in the compact formation shelf',()=>{
    const state=createScenario('recon-recovery'),result=resolveRound(state)
    const recovery=result.behaviorIntervals.find(interval=>interval.unitId==='raven'&&interval.mode==='recovering')!
    const seconds=recovery.start
    const markup=renderToStaticMarkup(<FormationDock squadrons={state.squadrons} bases={state.playerAssets} result={result} progress={seconds/result.duration} selectedId="raven" onSelect={()=>{}} onClearFollow={()=>{}} onAirfield={()=>{}}/>)
    expect(markup).toContain('ROUTE COMPLETE')
  })
})

describe('execution airfield chit rail', () => {
  it('shows only formations launched from the selected airfield', () => {
    const match = createMatch()
    const [homeFormation, forwardFormation] = match.squadrons
    const assets = match.playerAssets.map(asset => asset.kind === 'base'
      ? { ...asset, basedFormationIds: [homeFormation.id] }
      : asset)
    const fob: Asset = {
      id: 'fob-observe', kind: 'fob', name: 'FOB WATCH', position: [0, 0], intel: 'confirmed',
      confidence: 100, health: 100, maxHealth: 100, hidden: false, struck: false,
      operational: true, capacity: 1, basedFormationIds: [forwardFormation.id],
    }

    const markup = renderToStaticMarkup(<ExecutionChitRail squadrons={match.squadrons} bases={[...assets, fob]} progress={.4} activeBaseId={fob.id} selectedId={homeFormation.id} onSelect={() => {}}/>)

    expect(markup).toContain('FOB WATCH')
    expect(markup).toContain(forwardFormation.callsign)
    expect(markup).not.toContain(homeFormation.callsign)
  })
})

describe('map-first planning shelf', () => {
  const noop = () => {}
  const common = {
    onSelect: noop,
    onClear: noop, onCommit: noop, onClose: noop, reviewedIds: new Set<string>(), reviewedCount: 0, totalCount: 4,
  }

  it('puts PvP Lock orders on the left', () => {
    const match = createMatch()
    const markup = renderToStaticMarkup(<CommandShelf {...common} squadrons={match.squadrons}
      squadron={match.squadrons[0]} step="idle" onlineLock allowEmptyCommit/>)
    expect(markup).toMatch(/online-commit-first"><button[^>]*>.*Lock orders/s)
  })

  it('offers Commit round when no formation can launch', () => {
    const match = createMatch()
    const squadrons = match.squadrons.map(formation => ({ ...formation, aircraft: 0 }))
    const markup = renderToStaticMarkup(<CommandShelf {...common} squadrons={squadrons}
      squadron={squadrons[0]} step="idle" totalCount={0} allowEmptyCommit/>)
    expect(markup).toContain('No aircraft available')
    expect(markup).toContain('class="shelf-primary">Commit round')
  })

  it('offers map gestures and an escort picker for fighters', () => {
    const match = createMatch()
    const markup = renderToStaticMarkup(<CommandShelf {...common} squadrons={match.squadrons}
      squadron={match.squadrons[0]} step="route" reviewedIds={new Set(['raven'])}/>)
    expect(markup).toContain('planning-strip')
    expect(markup).toContain('aria-label="Undo last waypoint"')
    expect(markup).toContain('aria-label="Escort flight"')
    expect(markup).toContain('RAVEN 3')
    expect(markup).not.toContain('Select targets')
    expect(markup.match(/<select/g)).toHaveLength(1)
  })

  it('shows the two recon postures with Passive mapped to the saved conservative order', () => {
    const match = createMatch()
    const recon = { ...match.squadrons.find(flight => flight.role === 'recon')!, reconPosture: 'conservative' as const }
    const markup = renderToStaticMarkup(<CommandShelf {...common} squadrons={match.squadrons}
      squadron={recon} step="route"/>)
    expect(markup).toContain('aria-pressed="true">Passive')
    expect(markup).toContain('aria-pressed="false">Aggressive')
    expect(markup).not.toContain('<select')
  })

  it('keeps a bomber on target picking with a visible payload count', () => {
    const match = createMatch()
    const bomber = { ...match.squadrons[0], role: 'bomber' as const, mission: 'bomb' as const,
      bombingTargets: [{ targetId: 'e-base', routeIndex: 1 }] }
    const markup = renderToStaticMarkup(<CommandShelf {...common} squadrons={[bomber]}
      squadron={bomber} step="route"/>)
    expect(markup).toContain('planning-strip')
    expect(markup).toContain('1 / 3 targets')
    expect(markup).toContain('Clear targets')
    expect(markup).not.toContain('Undo last waypoint')
  })
})
