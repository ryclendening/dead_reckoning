import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createCampaignDraft } from '../game/data'
import { CampaignSetupPanel } from './CampaignSetupPanel'

describe('campaign setup panel', () => {
  it('shows the fixed force and only asks the player to choose support assets', () => {
    const match = createCampaignDraft()
    const markup = renderToStaticMarkup(<CampaignSetupPanel match={match} onChange={() => {}} onContinue={() => {}} />)

    expect(markup).toContain('VIPER 1 FIGHTER')
    expect(markup).toContain('FALCON 2 FIGHTER')
    expect(markup).toContain('RAVEN 3 RECON')
    expect(markup).toContain('SUPPORT · CHOOSE 2')
    expect(markup).not.toContain('GHOST')
    expect(markup).not.toContain('FORMATIONS</b>')
  })

  it('describes a legacy saved roster without offering formation selection', () => {
    const match = createCampaignDraft()
    const setup = { ...match.setup!, selectedFormationIds: ['viper', 'raven', 'ghost'] }
    const legacyDraft = { ...match, setup }
    const markup = renderToStaticMarkup(<CampaignSetupPanel match={legacyDraft} onChange={() => {}} onContinue={() => {}} />)

    expect(markup).toContain('This saved deployment keeps its previously selected force.')
    expect(markup).toContain('VIPER 1 FIGHTER · RAVEN 3 RECON · GHOST 4 RECON')
    expect(markup).not.toContain('FORMATIONS</b>')
    expect(markup).not.toContain('GHOST</b>')
  })
})
