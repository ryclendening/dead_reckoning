import { CheckCircle2, ChevronRight, Crosshair, Eye, Shield, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { SETUP_OPTIONAL_ASSET_IDS, setupAssetLabel, toggleSetupAsset, toggleSetupFormation, validateCampaignAllocation } from '../game/campaignSetup'
import type { Asset, CampaignSetupState, MatchState, Squadron } from '../game/types'

interface CampaignSetupPanelProps {
  match: MatchState
  onChange: (setup: CampaignSetupState) => void
  onContinue: () => void
  placementId?: string
  onSelectPlacement?: (id: string) => void
}

/** Compact, map-first allocation surface. Placement/review controls are added in the next chunk. */
export function CampaignSetupPanel({ match, onChange, onContinue, placementId, onSelectPlacement }: CampaignSetupPanelProps) {
  const setup = match.setup
  if (!setup) return null
  const errors = validateCampaignAllocation(match, setup)
  const optionalAssets = match.playerAssets.filter(asset => SETUP_OPTIONAL_ASSET_IDS.includes(asset.id as typeof SETUP_OPTIONAL_ASSET_IDS[number]))
  const selectedFormations = new Set(setup.selectedFormationIds)
  const selectedAssets = new Set(setup.selectedAssetIds)
  const toggleFormation = (id: string) => onChange(toggleSetupFormation(setup, id))
  const toggleAsset = (id: string) => onChange(toggleSetupAsset(setup, id))
  if (setup.stage !== 'allocate') return <section className="campaign-setup-float" aria-label="Initial campaign planning"><header><div><small>INITIAL PLANNING · {setup.stage === 'place' ? 'FORWARD DEPLOYMENT' : 'REVIEW'}</small><h2>{setup.stage === 'place' ? 'PLACE YOUR PACKAGE' : 'OPENING PACKAGE'}</h2></div><span>{setup.placedAssetIds.length}/{setup.selectedAssetIds.length} PLACED</span></header><p className="campaign-setup-copy">{setup.stage === 'place' ? 'Select a card, then tap a valid hex inside friendly territory.' : 'Confirm the selected force and support package to enter Planning.'}</p>{setup.stage === 'place' ? <div className="campaign-setup-options">{setup.selectedAssetIds.map(id => { const asset = match.playerAssets.find(item => item.id === id); if (!asset) return null; return <SetupOption key={id} selected={placementId === id || setup.placedAssetIds.includes(id)} icon={<Shield/>} title={setupAssetLabel(id)} detail={setup.placedAssetIds.includes(id) ? 'PLACED · TAP TO REPOSITION' : 'SELECT TO PLACE'} onClick={() => onSelectPlacement?.(id)}/> })}</div> : <p className="campaign-setup-ready"><CheckCircle2/> ALL SELECTED ASSETS PLACED</p>}<button className="campaign-setup-continue" disabled={setup.stage === 'place' && setup.placedAssetIds.length < setup.selectedAssetIds.length} onClick={onContinue}>{setup.stage === 'place' ? 'REVIEW PACKAGE' : 'BEGIN PLANNING'} <ChevronRight/></button></section>
  return <section className="campaign-setup-float" aria-label="Initial campaign planning">
    <header><div><small>INITIAL PLANNING · FORCE ALLOCATION</small><h2>BUILD YOUR PACKAGE</h2></div><span>{setup.selectedFormationIds.length}/3 FORMATIONS</span></header>
    <p className="campaign-setup-copy">Choose the force and support package that will enter the first Planning round. Placement comes next.</p>
    <div className="campaign-setup-group"><b>FORMATIONS</b><div className="campaign-setup-options">{match.squadrons.map(squadron => <SetupOption key={squadron.id} selected={selectedFormations.has(squadron.id)} disabled={squadron.status === 'destroyed'} icon={squadron.role === 'fighter' ? <Crosshair/> : <Eye/>} title={squadron.callsign} detail={`${squadron.role.toUpperCase()} · ${squadron.aircraft} AIRCRAFT`} onClick={() => toggleFormation(squadron.id)}/>)}</div></div>
    <div className="campaign-setup-group"><b>SUPPORT · CHOOSE 2</b><div className="campaign-setup-options">{optionalAssets.map(asset => <SetupOption key={asset.id} selected={selectedAssets.has(asset.id)} icon={<Shield/>} title={setupAssetLabel(asset.id)} detail={asset.kind.toUpperCase()} onClick={() => toggleAsset(asset.id)}/>)}</div></div>
    {errors.length ? <p className="campaign-setup-error" role="alert">{errors[0]}</p> : <p className="campaign-setup-ready"><CheckCircle2/> PACKAGE READY FOR PLACEMENT</p>}
    <button className="campaign-setup-continue" disabled={errors.length > 0} onClick={onContinue}>PLACE PACKAGE <ChevronRight/></button>
  </section>
}

function SetupOption({ selected, disabled, icon, title, detail, onClick }: { selected: boolean; disabled?: boolean; icon: ReactNode; title: string; detail: string; onClick: () => void }) {
  return <button className={`campaign-setup-option ${selected ? 'selected' : ''}`} disabled={disabled} onClick={onClick}><span>{icon}</span><b>{title}</b><small>{detail}</small>{selected ? <X className="campaign-setup-check"/> : null}</button>
}
