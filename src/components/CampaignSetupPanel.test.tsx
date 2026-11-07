import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createCampaignDraft } from '../game/data'
import { CampaignSetupPanel } from './CampaignSetupPanel'

describe('campaign setup panel', () => {
  it('shows the fixed force and fixed asset placement package', () => {
    const match = createCampaignDraft()
    const markup = renderToStaticMarkup(<CampaignSetupPanel match={match} onContinue={() => {}} onDifficultyChange={() => {}} />)

    expect(markup).toContain('VIPER 1 FIGHTER')
    expect(markup).toContain('FALCON 2 FIGHTER')
    expect(markup).toContain('RAVEN 3 RECON')
    expect(markup).toContain('MAIN AIRFIELD')
    expect(markup).toContain('<b>SAM</b>')
    expect(markup).toContain('<b>AAA</b>')
    expect(markup).not.toContain('DECOY')
    expect(markup).not.toContain('GHOST')
    expect(markup).not.toContain('FORMATIONS</b>')
  })

  it('describes a legacy saved roster without offering formation selection', () => {
    const match = createCampaignDraft()
    const setup = { ...match.setup!, selectedFormationIds: ['viper', 'raven', 'ghost'] }
    const legacyDraft = { ...match, setup }
    const markup = renderToStaticMarkup(<CampaignSetupPanel match={legacyDraft} onContinue={() => {}} onDifficultyChange={() => {}} />)

    expect(markup).toContain('SAVED FORCE')
    expect(markup).toContain('VIPER 1 FIGHTER · RAVEN 3 RECON · GHOST 4 RECON')
    expect(markup).not.toContain('FORMATIONS</b>')
    expect(markup).not.toContain('GHOST</b>')
  })
})
