import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createMatch } from '../game/data'
import type { Asset } from '../game/types'
import { CommandShelf, ExecutionChitRail } from './Hud'

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

  it('offers responsibility missions directly with no fighter custom option', () => {
    const match = createMatch()
    const fighter = match.squadrons.find(squadron => squadron.role === 'fighter')!
    const markup = renderToStaticMarkup(<CommandShelf
      squadrons={match.squadrons} bases={match.playerAssets} activeBaseId="p-base" rosterMode="closed"
      squadron={fighter} routeDistance={10} maxDistance={40} onSelect={noop} onBaseSelect={noop}
      onRosterMode={noop} onMission={noop} onClear={noop} onAdvance={noop} onCommit={noop}
      step="route" onClose={noop} reviewedIds={new Set()} reviewedCount={0} totalCount={4}
    />)

    expect(markup).toContain('DEFENSIVE CAP')
    expect(markup).toContain('FORWARD PATROL')
    expect(markup).not.toContain('CUSTOM RECON')
    expect(markup).not.toMatch(/CONSERVATIVE|NEUTRAL|AGGRESSIVE|POSTURE/)
  })

  it('fixes reconnaissance formations to the Search Area mission', () => {
    const match = createMatch()
    const recon = match.squadrons.find(squadron => squadron.role === 'recon')!
    const markup = renderToStaticMarkup(<CommandShelf
      squadrons={match.squadrons} bases={match.playerAssets} activeBaseId="p-base" rosterMode="closed"
      squadron={recon} routeDistance={10} maxDistance={48} onSelect={noop} onBaseSelect={noop}
      onRosterMode={noop} onMission={noop} onClear={noop} onAdvance={noop} onCommit={noop}
      step="route" onClose={noop} reviewedIds={new Set()} reviewedCount={0} totalCount={4}
    />)

    expect(markup).toContain('SEARCH AREA')
    expect(markup).toContain('FIXED MISSION')
    expect(markup).toContain('disabled=""')
    expect(markup).not.toContain('DEEP PROBE')
    expect(markup).not.toContain('CUSTOM RECON')
  })
})
