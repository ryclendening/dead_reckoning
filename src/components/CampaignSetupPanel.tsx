import { Check, ChevronRight } from 'lucide-react'
import { SETUP_REQUIRED_ASSET_IDS, setupAssetLabel, validateCampaignAllocation } from '../game/campaignSetup'
import type { MatchState } from '../game/types'

interface CampaignSetupPanelProps {
  match: MatchState
  onContinue: () => void
  placementId?: string
  onSelectPlacement?: (id: string) => void
  online?: boolean
}

export function CampaignSetupPanel({ match, onContinue, placementId, onSelectPlacement, online = false }: CampaignSetupPanelProps) {
  const setup = match.setup
  if (!setup) return null
  const errors = validateCampaignAllocation(match, setup)
  const placedCount = SETUP_REQUIRED_ASSET_IDS.filter(id => setup.placedAssetIds.includes(id)).length
  const allPlaced = placedCount === SETUP_REQUIRED_ASSET_IDS.length

  return <section className="phase-panel campaign-setup-float" aria-label="Site placement">
    <header className="phase-panel-heading"><h2>Place sites</h2><span>{placedCount}/{SETUP_REQUIRED_ASSET_IDS.length} placed</span></header>
    <div className="phase-panel-content">
      <p className="campaign-setup-copy">Pick a site. Tap a marked hex.</p>
      <div className="campaign-setup-options">
        {SETUP_REQUIRED_ASSET_IDS.map(id => {
          const placed = setup.placedAssetIds.includes(id)
          const label = setupAssetLabel(id)
          return <button type="button" key={id} className={`campaign-setup-option${placed ? ' placed' : ''}`}
            aria-label={placed ? `${label}, placed` : label} aria-pressed={placementId === id} onClick={() => onSelectPlacement?.(id)}>
            <b>{label}</b>{placed ? <Check aria-hidden="true"/> : null}
          </button>
        })}
      </div>
      {errors.length ? <p className="campaign-setup-error" role="alert">{errors[0]}</p> : null}
    </div>
    <div className="phase-panel-footer"><button type="button" className="phase-primary" disabled={!allPlaced || errors.length > 0} onClick={onContinue}>
      {online ? 'Lock deployment' : 'Begin planning'} <ChevronRight aria-hidden="true"/>
    </button></div>
  </section>
}
