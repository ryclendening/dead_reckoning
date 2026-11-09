import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createMatch,enemyBaseFor } from '../game/data'
import {createRoundSimulation,resolveRound} from '../game/engine'
import {createScenario} from '../game/scenarios'
import type { Asset } from '../game/types'
import { CommandShelf, ContactTracks, ExecutionChitRail, FormationDock } from './Hud'

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

describe('mission planning shelf', () => {
  const noop = () => {}

  it('shows fighter task choices without a bottom route-advance button', () => {
    const match = createMatch()
    const fighter = match.squadrons.find(squadron => squadron.role === 'fighter')!
    const markup = renderToStaticMarkup(<CommandShelf
      squadrons={match.squadrons} bases={match.playerAssets} activeBaseId="p-base" rosterMode="closed"
      squadron={fighter} routeDistance={10} maxDistance={40} onSelect={noop} onBaseSelect={noop}
      onRosterMode={noop} onMission={noop} onClear={noop} onCommit={noop}
      step="mission" onClose={noop} reviewedIds={new Set()} reviewedCount={0} totalCount={4}
    />)

    expect(markup).toContain('CHOOSE TASK')
    expect(markup).not.toContain('BUILD ROUTE')
    expect(markup).toContain('FORWARD PATROL')
    expect(markup).not.toContain('CLEAR ROUTE')
    expect(markup).not.toContain('class="route-budget"')
    expect(markup).not.toContain('CUSTOM RECON')
    expect(markup).not.toMatch(/CONSERVATIVE|NEUTRAL|AGGRESSIVE|POSTURE/)
  })

  it('explains site and escort selection while building a Protect route',()=>{
    const match=createMatch()
    const fighter=match.squadrons.find(squadron=>squadron.role==='fighter')!
    const markup=renderToStaticMarkup(<CommandShelf
      squadrons={match.squadrons} bases={match.playerAssets} activeBaseId="p-base" rosterMode="closed"
      squadron={fighter} routeDistance={10} maxDistance={40} onSelect={noop} onBaseSelect={noop}
      onRosterMode={noop} onMission={noop} onPickProtectTarget={noop} onProtectFlight={noop} onClear={noop} onCommit={noop}
      step="route" onClose={noop} reviewedIds={new Set([match.squadrons.find(item=>item.role==='recon')!.id])} reviewedCount={1} totalCount={4} selectingProtectTarget
    />)
    expect(markup).toContain('Tap a site or map point.')
    expect(markup).toContain('DEFEND AREA')
    expect(markup).toContain('ESCORT FLIGHT')
    expect(markup).toContain('RAVEN 3')
    expect(markup).not.toContain('GHOST 4')
    expect(markup).toContain('aria-label="Next aircraft"')
    expect(markup).not.toContain('class="shelf-primary"')
    expect(markup).not.toContain('AREA SIZE')
  })

  it('keeps confirmed escort coverage visible in the collapsed order shelf',()=>{
    const match=createMatch()
    const fighter=match.squadrons.find(squadron=>squadron.role==='fighter')!
    const markup=renderToStaticMarkup(<CommandShelf
      squadrons={match.squadrons} bases={match.playerAssets} activeBaseId="p-base" rosterMode="closed"
      squadron={fighter} routeDistance={10} maxDistance={40} onSelect={noop} onBaseSelect={noop}
      onRosterMode={noop} onMission={noop} onClear={noop} onCommit={noop}
      step="idle" onClose={noop} reviewedIds={new Set([fighter.id])} reviewedCount={1} totalCount={4}
      protectSummary="ESCORT RECON 60% COVERED · 40% UNCOVERED"
    />)

    expect(markup).toContain('ESCORT RECON 60% COVERED · 40% UNCOVERED')
    expect(markup).not.toContain('ORDERS READY · SELECT FLIGHTS OR COMMIT')
  })

  it('fixes reconnaissance formations to the Search Area mission', () => {
    const match = createMatch()
    const recon = match.squadrons.find(squadron => squadron.role === 'recon')!
    const markup = renderToStaticMarkup(<CommandShelf
      squadrons={match.squadrons} bases={match.playerAssets} activeBaseId="p-base" rosterMode="closed"
      squadron={recon} routeDistance={10} maxDistance={48} onSelect={noop} onBaseSelect={noop}
      onRosterMode={noop} onMission={noop} onClear={noop} onCommit={noop}
      step="route" onClose={noop} reviewedIds={new Set()} reviewedCount={0} totalCount={4}
    />)

    expect(markup).toContain('SEARCH AREA')
    expect(markup).toContain('BUILD ROUTE')
    expect(markup).toContain('aria-label="Next aircraft"')
    expect(markup).not.toContain('CHOOSE TASK')
    expect(markup).not.toContain('DEEP PROBE')
    expect(markup).not.toContain('CUSTOM RECON')
  })

  it('offers a direct home recovery order to recon staged at a FOB', () => {
    const match = createMatch()
    const recon = match.squadrons.find(squadron => squadron.role === 'recon')!
    const fob: Asset = { id: 'p-fob-1', kind: 'fob', name: 'FOB ALPHA', position: [0, 0], intel: 'confirmed',
      confidence: 100, health: 100, maxHealth: 100, hidden: false, struck: false, operational: true,
      capacity: 2, basedFormationIds: [recon.id] }
    const markup = renderToStaticMarkup(<CommandShelf
      squadrons={match.squadrons} bases={[...match.playerAssets, fob]} activeBaseId={fob.id} rosterMode="closed"
      squadron={recon} routeDistance={10} maxDistance={48} onSelect={noop} onBaseSelect={noop}
      onRosterMode={noop} onMission={noop} onRecoverHome={noop} onClear={noop} onCommit={noop}
      step="route" onClose={noop} reviewedIds={new Set()} reviewedCount={0} totalCount={4}
    />)
    expect(markup).toContain('RECOVER HOME')
  })

  it('keeps ground strike visible but disabled with the intelligence gate explained', () => {
    const match = createMatch()
    const fighter = match.squadrons.find(squadron => squadron.role === 'fighter')!
    const markup = renderToStaticMarkup(<CommandShelf
      squadrons={match.squadrons} bases={match.playerAssets} activeBaseId="p-base" rosterMode="closed"
      squadron={fighter} routeDistance={10} maxDistance={40} onSelect={noop} onBaseSelect={noop}
      onRosterMode={noop} onMission={noop} onClear={noop} onCommit={noop}
      step="mission" onClose={noop} reviewedIds={new Set()} reviewedCount={0} totalCount={4}
      campaign strikeDisabledReason="RECOVER GROUND TARGET INTELLIGENCE FIRST"
    />)

    expect(markup).toContain('GROUND STRIKE')
    expect(markup).toContain('RECOVER GROUND TARGET INTELLIGENCE FIRST')
    expect(markup).toContain('disabled=""')
  })
})
