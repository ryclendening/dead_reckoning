import { Check, CheckCircle2, ChevronRight, Shield, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { SETUP_REQUIRED_ASSET_IDS, setupAssetLabel, validateCampaignAllocation } from '../game/campaignSetup'
import type { MatchState } from '../game/types'

interface CampaignSetupPanelProps {
  match: MatchState
  onContinue: () => void
  placementId?: string
  onSelectPlacement?: (id: string) => void
  hasPlacementPreview?: boolean
  onConfirmPlacement?: () => void
  onCancelPlacement?: () => void
}

/** Compact, map-first placement surface for the fixed opening package. */
export function CampaignSetupPanel({ match, onContinue, placementId, onSelectPlacement, hasPlacementPreview, onConfirmPlacement, onCancelPlacement }: CampaignSetupPanelProps) {
  const setup = match.setup
  if (!setup) return null
  const errors = validateCampaignAllocation(match, setup)
  const openingFormations = match.squadrons.filter(squadron => setup.selectedFormationIds.includes(squadron.id))
  const fixedOpeningForce = ['viper', 'falcon', 'raven'].every(id => setup.selectedFormationIds.includes(id))
  const stage = setup.stage === 'review' ? 'review' : 'place'
  return <section className="campaign-setup-float" aria-label="Initial campaign planning"><header><div><small>INITIAL PLANNING · {stage === 'place' ? 'FORWARD DEPLOYMENT' : 'REVIEW'}</small><h2>{stage === 'place' ? 'PLACE YOUR PACKAGE' : 'OPENING PACKAGE'}</h2></div><span>{setup.placedAssetIds.length}/{SETUP_REQUIRED_ASSET_IDS.length} PLACED</span></header><p className="campaign-setup-copy">{stage === 'place' ? hasPlacementPreview ? 'Confirm this hex to lock in the asset.' : 'Choose an asset, tap a highlighted hex, then confirm its site.' : 'Your force and support package are ready.'}</p><p className="campaign-setup-copy"><strong>OPENING FORCE</strong> · {openingFormations.map(squadron => `${squadron.callsign} ${squadron.role.toUpperCase()}`).join(' · ')}{fixedOpeningForce ? '' : ' · SAVED FORCE'}</p>{stage === 'place' ? <div className="campaign-setup-options">{SETUP_REQUIRED_ASSET_IDS.map(id => <SetupOption key={id} selected={placementId === id} icon={<Shield/>} title={setupAssetLabel(id)} detail={setup.placedAssetIds.includes(id) ? 'PLACED · TAP TO MOVE' : 'SELECT TO PLACE'} onClick={() => onSelectPlacement?.(id)}/>)}</div> : <p className="campaign-setup-ready"><CheckCircle2/> ALL FOUR ASSETS PLACED</p>}{hasPlacementPreview ? <div className="campaign-placement-confirm"><button type="button" onClick={onCancelPlacement}><X/> CANCEL</button><button type="button" className="confirm" onClick={onConfirmPlacement}><Check/> CONFIRM SITE</button></div> : null}{errors.length ? <p className="campaign-setup-error" role="alert">{errors[0]}</p> : null}<button className="campaign-setup-continue" disabled={stage === 'place' && setup.placedAssetIds.length < SETUP_REQUIRED_ASSET_IDS.length} onClick={onContinue}>{stage === 'place' ? 'REVIEW PACKAGE' : 'BEGIN PLANNING'} <ChevronRight/></button></section>
}

function SetupOption({ selected, icon, title, detail, onClick }: { selected: boolean; icon: ReactNode; title: string; detail: string; onClick: () => void }) {
  return <button className={`campaign-setup-option ${selected ? 'selected' : ''}`} onClick={onClick}><span>{icon}</span><b>{title}</b><small>{detail}</small></button>
}
