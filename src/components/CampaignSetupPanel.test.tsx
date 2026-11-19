import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createCampaignDraft } from '../game/data'
import { CampaignSetupPanel } from './CampaignSetupPanel'

describe('campaign setup panel', () => {
  it('shows the fixed site choices with one instruction and placement progress', () => {
    const match = createCampaignDraft()
    match.setup!.placedAssetIds = ['p-radar']
    const markup = renderToStaticMarkup(<CampaignSetupPanel match={match} placementId="p-radar" onContinue={() => {}} />)

    expect(markup).toContain('Pick a site. Tap a marked hex.')
    expect(markup).toContain('1/4 placed')
    expect(markup).toContain('aria-label="RADAR, placed" aria-pressed="true"')
    expect(markup).toContain('MAIN AIRFIELD')
    expect(markup).toContain('<b>SAM</b>')
    expect(markup).toContain('<b>AAA</b>')
    expect(markup).toContain('disabled="">Begin planning')
    expect(markup).not.toContain('VIPER')
    expect(markup).not.toContain('dashed circle')
  })

  it('enables the multiplayer lock after placing all four sites', () => {
    const match = createCampaignDraft()
    match.setup!.placedAssetIds = [...match.setup!.selectedAssetIds]
    const markup = renderToStaticMarkup(<CampaignSetupPanel online match={match} onContinue={() => {}} />)

    expect(markup).toContain('4/4 placed')
    expect(markup).toContain('class="phase-primary">Lock deployment')
  })
})
