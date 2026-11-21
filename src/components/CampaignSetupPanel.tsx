import { Check, ChevronRight, Crosshair, Radar, RadioTower, Rocket, Warehouse } from 'lucide-react'
import { SETUP_REQUIRED_ASSET_IDS, setupAssetById, setupAssetLabel, validateCampaignAllocation } from '../game/campaignSetup'
import type { MatchState } from '../game/types'

const siteIcons = {
  base: Warehouse, fob: Warehouse, decoy: RadioTower, radar: Radar, sam: Rocket, aaa: Crosshair,
}

interface CampaignSetupPanelProps {
  match: MatchState
  onContinue: () => void
  placementId?: string
  onSelectPlacement?: (id: string) => void
  online?: boolean
  busy?: boolean
  locked?: boolean
  opponentLocked?: boolean
}

export function CampaignSetupPanel({
  match, onContinue, placementId, onSelectPlacement, online = false,
  busy = false, locked = false, opponentLocked = false,
}: CampaignSetupPanelProps) {
  const setup = match.setup
  const errors = setup ? validateCampaignAllocation(match, setup) : []
  const sites = setup
    ? SETUP_REQUIRED_ASSET_IDS.map(id => setupAssetById(match, id)).filter(site => site !== undefined)
    : match.playerAssets
  const placedCount = sites.filter(site => setup?.placedAssetIds.includes(site.id)).length
  const requiredCount = SETUP_REQUIRED_ASSET_IDS.length
  const ready = !setup || placedCount === requiredCount
  const status = locked ? opponentLocked ? 'Both sides locked' : 'Waiting for opponent'
    : ready && setup ? 'Tap a hex to move' : 'Tap a marked hex'

  return <section className="phase-panel deployment-strip" aria-label="Site placement">
    <nav className="deployment-sites" aria-label="Starting sites">
      {sites.map(site => {
        const placed = setup?.placedAssetIds.includes(site.id)
        const label = setupAssetLabel(site.kind)
        const Icon = siteIcons[site.kind]
        return <button type="button" key={site.id} className="site-chip"
          aria-label={placed ? `${label}, placed` : label} aria-pressed={!locked && placementId === site.id}
          disabled={locked || busy} onClick={() => onSelectPlacement?.(site.id)}>
          <Icon aria-hidden="true"/>
          <span>{site.kind === 'base' ? 'Airfield' : label}</span>
          {placed ? <Check className="site-placed-cue" aria-hidden="true"/> : null}
        </button>
      })}
    </nav>
    <div className="phase-panel-footer">
      <div className="deployment-status">
        {setup ? <b aria-live="polite">{placedCount}/{requiredCount} placed</b> : null}
        {errors[0] && !locked ? <small role="alert">{errors[0]}</small> : <small>{status}</small>}
      </div>
      <button type="button" className="phase-primary" disabled={locked || busy || !ready || errors.length > 0} onClick={onContinue}>
        {locked ? 'Deployment locked' : online ? 'Lock deployment' : 'Plan round 1'}
        {locked ? <Check aria-hidden="true"/> : <ChevronRight aria-hidden="true"/>}
      </button>
    </div>
  </section>
}
