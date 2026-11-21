import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createCampaignDraft } from '../game/data'
import { CampaignSetupPanel } from './CampaignSetupPanel'

describe('campaign setup panel', () => {
  it('shows the fixed site choices with one instruction and placement progress', () => {
    const match = createCampaignDraft()
    match.setup!.placedAssetIds = ['p-radar']
    const markup = renderToStaticMarkup(<CampaignSetupPanel match={match} placementId="p-radar" onContinue={() => {}} />)

    expect(markup).toContain('aria-label="Starting sites"')
    expect(markup).toContain('Tap a marked hex')
    expect(markup).toContain('1/4 placed')
    expect(markup).toContain('aria-label="RADAR, placed" aria-pressed="true"')
    expect(markup).toContain('MAIN AIRFIELD')
    expect(markup).toContain('<span>SAM</span>')
    expect(markup).toContain('<span>AAA</span>')
    expect(markup).toContain('disabled="">Plan round 1')
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

  it('keeps the completed rail visible while waiting for the opponent', () => {
    const match = createCampaignDraft()
    match.setup!.placedAssetIds = [...match.setup!.selectedAssetIds]
    const markup = renderToStaticMarkup(<CampaignSetupPanel online locked match={match} placementId="p-base" onContinue={() => {}} />)

    expect(markup).toContain('aria-label="MAIN AIRFIELD, placed" aria-pressed="false" disabled=""')
    expect(markup).toContain('Waiting for opponent')
    expect(markup).toContain('class="phase-primary" disabled="">Deployment locked')
  })
})
