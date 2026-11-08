import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createMatch } from '../game/data'
import { campaignOutcomeMessage, EndState } from '../App'
import { CampaignBriefing } from './CampaignBriefing'

describe('campaign briefing', () => {
  it('gives sector-based discovery guidance and hides unknown base health', () => {
    const match = createMatch()
    const hidden = match.enemyAssets.find(asset => asset.kind === 'base')!
    const markup = renderToStaticMarkup(<CampaignBriefing match={match} homeHealth={100}/>)
    const opposite: Record<string, string> = { 'north-west': 'south-east', 'north-east': 'south-west', 'south-west': 'north-east', 'south-east': 'north-west' }

    expect(markup).toContain('LOCATE AND STRIKE ENEMY BASE')
    expect(markup).toContain(opposite[match.world.startRegionId] ?? 'opposite sector')
    expect(markup).not.toContain('ENEMY BASE</span>')
    expect(markup).not.toContain(String(hidden.position[0]))
    expect(markup).not.toContain(String(hidden.position[1]))
  })

  it('shows enemy base health only for a confirmed target', () => {
    const match = createMatch()
    const target = { ...match.enemyAssets.find(asset => asset.kind === 'base')!, hidden: false, intel: 'confirmed' as const, health: 65 }
    const markup = renderToStaticMarkup(<CampaignBriefing match={match} target={target} homeHealth={82} enemyHealth={55}/>)

    expect(markup).toContain('STRIKE CONFIRMED BASE')
    expect(markup).toContain('ENEMY BASE')
    expect(markup).toContain('55%')
    expect(markup).toContain('82%')
  })

  it('explains a deadline draw without claiming the home base was destroyed', () => {
    const markup = renderToStaticMarkup(<EndState victory={false} round={6} outcome="deadline" onRestart={() => {}}/>)

    expect(markup).toContain('DRAW')
    expect(markup).toContain('Both bases survived the six-round campaign')
    expect(markup).not.toContain('home base has been rendered inoperable')
  })

  it('keeps decisive campaign debrief messages tied to their actual cause', () => {
    expect(campaignOutcomeMessage('enemy-base-destroyed').message).toContain('Your strike destroyed the enemy base')
    expect(campaignOutcomeMessage('home-base-destroyed').message).toContain('Enemy strikes destroyed your home base')
    expect(campaignOutcomeMessage('deadline').message).toContain('Both bases survived the six-round campaign')
    expect(campaignOutcomeMessage('forces-lost').message).toContain('formations and reserve aircraft have been lost')
  })
})
