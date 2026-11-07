import { CheckCircle2, ChevronRight, Shield } from 'lucide-react'
import type { ReactNode } from 'react'
import { SETUP_REQUIRED_ASSET_IDS, setupAssetLabel, validateCampaignAllocation } from '../game/campaignSetup'
import type { MatchState } from '../game/types'

interface CampaignSetupPanelProps {
  match: MatchState
  onContinue: () => void
  placementId?: string
  onSelectPlacement?: (id: string) => void
}

/** Compact, map-first placement surface for the fixed opening package. */
export function CampaignSetupPanel({ match, onContinue, placementId, onSelectPlacement }: CampaignSetupPanelProps) {
  const setup = match.setup
  if (!setup) return null
  const errors = validateCampaignAllocation(match, setup)
  const openingFormations = match.squadrons.filter(squadron => setup.selectedFormationIds.includes(squadron.id))
  const fixedOpeningForce = ['viper', 'falcon', 'raven'].every(id => setup.selectedFormationIds.includes(id))
  const allPlaced = SETUP_REQUIRED_ASSET_IDS.every(id => setup.placedAssetIds.includes(id))
  return <section className="campaign-setup-float" aria-label="Initial campaign planning"><header><div><small>INITIAL PLANNING · FORWARD DEPLOYMENT</small><h2>PLACE YOUR PACKAGE</h2></div><span>{setup.placedAssetIds.length}/{SETUP_REQUIRED_ASSET_IDS.length} POSITIONED</span></header><p className="campaign-setup-copy">Select an asset, then tap a highlighted hex to position it. Green placements are set; select one to move it before the final confirmation.</p><p className="campaign-setup-copy"><strong>OPENING FORCE</strong> · {openingFormations.map(squadron => `${squadron.callsign} ${squadron.role.toUpperCase()}`).join(' · ')}{fixedOpeningForce ? '' : ' · SAVED FORCE'}</p>{allPlaced ? <p className="campaign-setup-ready"><CheckCircle2/> ALL FOUR POSITIONS SET · READY TO LOCK</p> : null}<div className="campaign-setup-options">{SETUP_REQUIRED_ASSET_IDS.map(id => {const placed=setup.placedAssetIds.includes(id);return <SetupOption key={id} selected={placementId === id} placed={placed} icon={placed?<CheckCircle2/>:<Shield/>} title={setupAssetLabel(id)} detail={placed ? 'POSITION SET · TAP TO MOVE' : 'SELECT TO POSITION'} onClick={() => onSelectPlacement?.(id)}/>})}</div>{errors.length ? <p className="campaign-setup-error" role="alert">{errors[0]}</p> : null}<button className="campaign-setup-continue" disabled={!allPlaced || errors.length > 0} onClick={onContinue}>{allPlaced ? 'CONFIRM & BEGIN PLANNING' : 'POSITION ALL FOUR ASSETS'} <ChevronRight/></button></section>
}

function SetupOption({ selected, placed, icon, title, detail, onClick }: { selected: boolean; placed: boolean; icon: ReactNode; title: string; detail: string; onClick: () => void }) {
  return <button className={`campaign-setup-option${selected ? ' selected' : ''}${placed ? ' placed' : ''}`} onClick={onClick}><span>{icon}</span><b>{title}</b><small>{detail}</small></button>
}
