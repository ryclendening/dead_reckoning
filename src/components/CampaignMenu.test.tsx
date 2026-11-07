import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import App from '../App'
import { createCampaignDraft } from '../game/data'
import { CampaignMenu } from './CampaignMenu'

describe('campaign entry menu', () => {
  it('opens at the menu and does not invent a resumable campaign for a new visitor', () => {
    vi.stubGlobal('localStorage', { getItem: () => null })
    try {
      const html = renderToStaticMarkup(<App/>)
      expect(html).toContain('START NEW CAMPAIGN')
      expect(html).toContain('CPU DIFFICULTY')
      expect(html).not.toContain('CONTINUE CAMPAIGN')
      expect(html).not.toContain('<canvas')
    } finally { vi.unstubAllGlobals() }
  })
  it('offers a saved campaign and selects its difficulty without changing it', () => {
    const saved = createCampaignDraft(7301, 'hard')
    const html = renderToStaticMarkup(<CampaignMenu saved={saved} onContinue={() => {}} onStart={() => {}}/>)
    expect(html).toContain('CONTINUE CAMPAIGN')
    expect(html).toContain('ROUND 1 · HARD')
    expect(html).toMatch(/checked="" value="hard"/)
    expect(saved.cpu!.difficulty).toBe('hard')
  })
})
