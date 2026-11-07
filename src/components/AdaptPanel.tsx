import { useEffect, useMemo, useState } from 'react'
import { Check, ChevronRight, MapPin, Plus, Wrench, X } from 'lucide-react'
import { AIRFIELD_UPGRADE_CATALOG, economyAttentionTargets, economyCommandForQuote, economyQuotesFor, findMatchingEconomyQuote } from '../game/economy'
import { assetCardData } from '../game/unitCards'
import type { EconomyActionId, EconomyActionQuote, EconomyCommand, EconomyTarget, MatchState } from '../game/types'

export type ProcurementMode = 'closed' | 'catalog' | 'placing'

interface AdaptPanelProps {
  match: MatchState
  selectedTarget: EconomyTarget
  onSelectTarget: (target: EconomyTarget) => void
  onCloseTarget: () => void
  onPurchase: (command: EconomyCommand) => void
  onNextRound: () => void
  procurementMode: ProcurementMode
  procurementActionId?: EconomyActionId
  onProcurementMode: (mode: ProcurementMode) => void
  onProcurementAction: (actionId: EconomyActionId) => void
  hasPlacementPreview: boolean
  onConfirmPlacement: () => void
  onCancelPlacement: () => void
}

const targetKey = (target: EconomyTarget) => `${target.kind}:${target.id}`
const isRoutineRepair = (quote: EconomyActionQuote) => quote.id === 'repair-formation' || quote.id === 'repair-defense' || quote.id === 'repair-fob'

export function AdaptPanel({ match, selectedTarget, onSelectTarget, onCloseTarget, onPurchase, onNextRound, procurementMode, procurementActionId, onProcurementMode, onProcurementAction, hasPlacementPreview, onConfirmPlacement, onCancelPlacement }: AdaptPanelProps) {
  const [pending, setPending] = useState<EconomyActionQuote>()
  const quotes = [...economyQuotesFor(match, selectedTarget)].sort((left, right) => Number(right.id === 'replace-aircraft') - Number(left.id === 'replace-aircraft'))
  const attentionTargets = useMemo(() => economyAttentionTargets(match), [match])
  const procurementQuotes = economyQuotesFor(match, { kind: 'campaign', id: 'campaign' }).filter(quote => quote.effect.kind === 'asset-construction')
  const procurementQuote = procurementQuotes.find(item => item.id === procurementActionId)
  const procurementKind = procurementQuote?.effect.kind === 'asset-construction' ? procurementQuote.effect.assetKind : undefined
  const friendlyAsset = selectedTarget.kind === 'asset' ? match.playerAssets.find(asset => asset.id === selectedTarget.id) : undefined
  const selectedAsset = friendlyAsset ?? (selectedTarget.kind === 'asset' ? match.enemyAssets.find(asset => asset.id === selectedTarget.id && !asset.hidden && asset.intel !== 'unknown') : undefined)
  const assetData = selectedAsset ? assetCardData(selectedAsset, !friendlyAsset, 'adapt') : undefined
  const selectedSquadron = selectedTarget.kind === 'squadron' ? match.squadrons.find(squadron => squadron.id === selectedTarget.id) : undefined
  const basedFormations = friendlyAsset ? match.squadrons.filter(squadron => friendlyAsset.basedFormationIds?.includes(squadron.id)) : []
  const installedUpgrade = AIRFIELD_UPGRADE_CATALOG.find(upgrade => selectedAsset?.upgrades?.includes(upgrade.upgrade))
  const selected = findMatchingEconomyQuote(quotes, pending ? { actionId: pending.id, target: pending.target } : undefined)
  const roundIncome = match.economy.statement.filter(entry => entry.direction === 'income').reduce((total, entry) => total + entry.amount, 0)

  useEffect(() => setPending(undefined), [selectedTarget.kind, selectedTarget.id])

  const choose = (quote: EconomyActionQuote) => {
    if (!quote.eligible) return
    if (isRoutineRepair(quote)) {
      onPurchase(economyCommandForQuote(match, quote))
      return
    }
    setPending(quote)
  }
  const confirm = () => { if (!selected) return; onPurchase(economyCommandForQuote(match, selected)); setPending(undefined) }
  const cycleAttention = () => {
    if (!attentionTargets.length) return
    const currentIndex = attentionTargets.findIndex(target => targetKey(target) === targetKey(selectedTarget))
    onSelectTarget(attentionTargets[(currentIndex + 1) % attentionTargets.length])
  }
  return <section className="adapt-panel" aria-label="Adapt">
    <header className="adapt-heading"><details className="adapt-income"><summary>+{roundIncome} THIS ROUND</summary><div>{match.economy.statement.map(entry => <span key={entry.id} className={entry.direction}><b>{entry.direction === 'income' ? '+' : '-'}{entry.amount}</b><small>{entry.label}</small></span>)}</div></details><div className="adapt-balance"><Wrench/><b>{match.logistics}</b><small>LOGISTICS · {match.replacements} RESERVE</small></div></header>

    <div className="adapt-content">
    {procurementMode === 'catalog' ? <div className="adapt-drawer adapt-build-drawer" aria-label="Build options">
      <header className="adapt-build-heading"><b>BUILD ASSETS</b><button type="button" aria-label="Close Build" onClick={() => onProcurementMode('closed')}><X/></button></header>
      <div className="procure-catalog">{procurementQuotes.map(quote => <button key={quote.id} className="procure-option" disabled={!quote.eligible} onClick={() => quote.eligible && onProcurementAction(quote.id)}><MapPin/><span><b>{quote.effect.kind === 'asset-construction' ? quote.effect.assetKind.toUpperCase() : quote.label}</b><small>{quote.detail}</small>{quote.reason ? <em>{quote.reason}</em> : null}</span><strong>{quote.cost} L</strong></button>)}</div>
    </div> : null}
    {procurementMode === 'placing' ? <div className="adapt-drawer adapt-placement-drawer" aria-label={`Place ${procurementKind ?? 'asset'}`}>
      <header className="adapt-build-heading"><b><MapPin/> BUILD {procurementKind?.toUpperCase() ?? 'ASSET'} · {procurementQuote?.cost ?? 0} L</b><button type="button" aria-label="Cancel placement" onClick={() => onProcurementMode('closed')}><X/></button></header>
      <p className="procure-instruction">{hasPlacementPreview ? 'Confirm this hex to purchase and place the asset.' : 'Tap a highlighted hex to preview its site.'}</p>
      {hasPlacementPreview ? <div className="campaign-placement-confirm"><button type="button" onClick={onCancelPlacement}><X/> CANCEL</button><button type="button" className="confirm" onClick={onConfirmPlacement}><Check/> CONFIRM BUILD</button></div> : null}
    </div> : null}

    {procurementMode === 'closed' && (assetData || selectedSquadron) ? <div className="adapt-drawer adapt-selection" aria-label="Selected unit">
      <header className="adapt-drawer-title"><b>{assetData?.title ?? selectedSquadron?.callsign}</b><small>{assetData ? `${Math.round(assetData.health)} / ${assetData.maxHealth} HP` : `${selectedSquadron!.aircraft}/${selectedSquadron!.maxAircraft} AIRCRAFT · ${Math.round(selectedSquadron!.strength ?? 0)}%`}</small><button type="button" aria-label="Close selected unit" onClick={onCloseTarget}><X/></button></header>
      {assetData ? <><progress value={assetData.health} max={assetData.maxHealth} aria-label="Site health"/><p className="adapt-site-status">{!friendlyAsset ? 'ENEMY · ' : ''}{selectedAsset?.kind === 'sam' ? `${assetData.status} · RANGE 3.2` : selectedAsset?.kind === 'radar' ? `${assetData.status} · DETECTION RANGE 6.4` : selectedAsset?.kind === 'aaa' ? `${assetData.status} · RANGE 1.9` : selectedAsset?.kind === 'fob' && friendlyAsset ? `${assetData.status} · ${basedFormations.length}/${selectedAsset.capacity ?? 2} FORMATIONS` : assetData.status}</p></> : null}
      {basedFormations.length ? <div className="adapt-based-flights" aria-label="Based formations">{basedFormations.map(squadron => <button key={squadron.id} onClick={() => onSelectTarget({kind:'squadron',id:squadron.id})}>{squadron.callsign} <span>{squadron.aircraft}/{squadron.maxAircraft}</span></button>)}</div> : null}
      {installedUpgrade && friendlyAsset ? <p className="adapt-installed"><Check/>{installedUpgrade.label} INSTALLED</p> : null}
      {friendlyAsset?.kind === 'base' && quotes.length ? <p className="adapt-action-heading">UPGRADES · CHOOSE ONE</p> : null}
      {quotes.length ? <div className="adapt-actions">{quotes.map(quote => <button key={quote.id} disabled={!quote.eligible} className={selected?.id === quote.id ? 'selected' : ''} onClick={() => choose(quote)}><span><b>{quote.label}</b><small>{quote.detail}</small>{!quote.eligible && quote.reason ? <em>{quote.reason}</em> : null}</span><strong>{quote.cost} L{quote.reserveCost ? ` + ${quote.reserveCost} R` : ''}</strong></button>)}</div> : null}
      {selected ? <div className="adapt-confirm"><div><b>CONFIRM {selected.label}</b><small>{selected.projected.logistics} LOGISTICS · {selected.projected.reserveAircraft} RESERVE REMAIN</small></div><button onClick={() => setPending(undefined)}>CANCEL</button><button className="confirm" onClick={confirm}><Check/> CONFIRM</button></div> : null}
    </div> : null}
    </div>

    <div className={`adapt-controls ${attentionTargets.length ? 'has-attention' : ''}`}>
      <button className="adapt-build" onClick={() => onProcurementMode(procurementMode === 'catalog' ? 'closed' : 'catalog')}><Plus/><span>BUILD</span></button>
      {attentionTargets.length ? <button className="adapt-attention" aria-label={`Repairs and replacements (${attentionTargets.length})`} onClick={cycleAttention}><Wrench/><b>{attentionTargets.length}</b><span>REPAIRS &amp;<br/>REPLACEMENTS</span></button> : null}
      <button className="adapt-next" onClick={onNextRound}>BEGIN ROUND {String(match.round + 1).padStart(2, '0')} <ChevronRight/></button>
    </div>
  </section>
}
