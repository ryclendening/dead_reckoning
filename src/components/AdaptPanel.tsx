import { useEffect, useMemo, useState } from 'react'
import { Check, ChevronRight, MapPin, Plus, Wrench, X, Zap } from 'lucide-react'
import { economyAttentionTargets, economyCommandForQuote, economyQuotesFor, findMatchingEconomyQuote } from '../game/economy'
import type { EconomyActionId, EconomyActionQuote, EconomyCommand, EconomyTarget, MatchState } from '../game/types'

export type ProcurementMode = 'closed' | 'catalog' | 'placing'

interface AdaptPanelProps {
  match: MatchState
  selectedTarget: EconomyTarget
  onSelectTarget: (target: EconomyTarget) => void
  onPurchase: (command: EconomyCommand) => void
  onNextRound: () => void
  procurementMode: ProcurementMode
  procurementActionId?: EconomyActionId
  onProcurementMode: (mode: ProcurementMode) => void
  onProcurementAction: (actionId: EconomyActionId) => void
}

const targetLabel = (match: MatchState, target: EconomyTarget) => target.kind === 'campaign' ? 'CAMPAIGN' : target.kind === 'squadron'
  ? match.squadrons.find(item => item.id === target.id)?.callsign ?? 'FORMATION'
  : match.playerAssets.find(item => item.id === target.id)?.kind === 'base' ? 'MAIN AIRFIELD' : (match.playerAssets.find(item => item.id === target.id)?.name ?? match.playerAssets.find(item => item.id === target.id)?.kind ?? 'ASSET').toUpperCase()

const targetKey = (target: EconomyTarget) => `${target.kind}:${target.id}`
const isRoutineRepair = (quote: EconomyActionQuote) => quote.id === 'repair-formation' || quote.id === 'repair-defense' || quote.id === 'repair-fob'

export function AdaptPanel({ match, selectedTarget, onSelectTarget, onPurchase, onNextRound, procurementMode, procurementActionId, onProcurementMode, onProcurementAction }: AdaptPanelProps) {
  const [pending, setPending] = useState<EconomyActionQuote>()
  const quotes = [...economyQuotesFor(match, selectedTarget)].sort((left, right) => Number(right.id === 'replace-aircraft') - Number(left.id === 'replace-aircraft'))
  const attentionTargets = useMemo(() => economyAttentionTargets(match), [match])
  const procurementQuotes = economyQuotesFor(match, { kind: 'campaign', id: 'campaign' }).filter(quote => quote.effect.kind === 'asset-construction')
  const procurementQuote = procurementQuotes.find(item => item.id === procurementActionId)
  const procurementKind = procurementQuote?.effect.kind === 'asset-construction' ? procurementQuote.effect.assetKind : undefined
  const selectedAsset = selectedTarget.kind === 'asset' ? match.playerAssets.find(asset => asset.id === selectedTarget.id) : undefined
  const selectedSquadron = selectedTarget.kind === 'squadron' ? match.squadrons.find(squadron => squadron.id === selectedTarget.id) : undefined
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
    <header className="adapt-heading"><div><small>ROUND {String(match.round).padStart(2, '0')} · ADAPT</small></div><div className="adapt-balance"><Wrench/><b>{match.logistics}</b><small>LOGISTICS · {match.replacements} RESERVE</small></div></header>
    <details className="adapt-income"><summary>+{roundIncome} THIS ROUND</summary><div>{match.economy.statement.map(entry => <span key={entry.id} className={entry.direction}><b>{entry.direction === 'income' ? '+' : '-'}{entry.amount}</b><small>{entry.label}</small></span>)}</div></details>

    {procurementMode === 'catalog' ? <div className="adapt-drawer adapt-build-drawer" aria-label="Build options">
      <header className="adapt-build-heading"><b>BUILD ASSETS</b><button type="button" aria-label="Close Build" onClick={() => onProcurementMode('closed')}><X/></button></header>
      <div className="procure-catalog">{procurementQuotes.map(quote => <button key={quote.id} className="procure-option" disabled={!quote.eligible} onClick={() => quote.eligible && onProcurementAction(quote.id)}><MapPin/><span><b>{quote.effect.kind === 'asset-construction' ? quote.effect.assetKind.toUpperCase() : quote.label}</b><small>{quote.detail}</small>{quote.reason ? <em>{quote.reason}</em> : null}</span><strong>{quote.cost} L</strong></button>)}</div>
    </div> : null}
    {procurementMode === 'placing' ? <div className="adapt-drawer adapt-placement-drawer" aria-label={`Place ${procurementKind ?? 'asset'}`}>
      <header className="adapt-build-heading"><b><MapPin/> BUILD {procurementKind?.toUpperCase() ?? 'ASSET'} · {procurementQuote?.cost ?? 0} L</b><button type="button" aria-label="Cancel placement" onClick={() => onProcurementMode('closed')}><X/></button></header>
      <p className="procure-instruction">Tap a valid hex to build. Your balance updates right away.</p>
    </div> : null}

    {procurementMode === 'closed' && selectedTarget.kind !== 'campaign' ? <div className="adapt-drawer">
      <div className="adapt-drawer-title"><span>SELECTED</span><b>{targetLabel(match, selectedTarget)}</b>{selectedSquadron ? <small>{selectedSquadron.aircraft}/{selectedSquadron.maxAircraft} AIRCRAFT · {Math.round(selectedSquadron.strength ?? 0)}%</small> : null}</div>
      {selectedAsset?.kind === 'fob' ? <p className="adapt-empty"><b>{selectedAsset.operational ? 'OPERATIONAL' : 'UNUSABLE'}</b> · CAPACITY {selectedAsset.basedFormationIds?.length ?? 0}/{selectedAsset.capacity ?? 1} · {(selectedAsset.basedFormationIds??[]).map(id=>match.squadrons.find(squadron=>squadron.id===id)?.callsign??id).join(', ')||'NO FORMATIONS BASED'}</p> : null}
      {quotes.length ? <div className="adapt-actions">{quotes.map((quote, index) => <button key={quote.id} disabled={!quote.eligible} className={`${selected?.id === quote.id ? 'selected' : ''} ${index === 0 ? 'primary' : ''}`} onClick={() => choose(quote)}><span><b>{quote.label}</b><small>{quote.detail}</small>{!quote.eligible && quote.reason ? <em>{quote.reason}</em> : null}</span><strong>{quote.cost} L{quote.reserveCost ? ` + ${quote.reserveCost} R` : ''}</strong></button>)}</div> : selectedAsset?.kind !== 'fob' ? <p className="adapt-empty">No action required. Select an asset on the map or cycle Needs Attention.</p> : null}
      {selected ? <div className="adapt-confirm"><div><b>CONFIRM {selected.label}</b><small>{selected.projected.logistics} LOGISTICS · {selected.projected.reserveAircraft} RESERVE REMAIN</small></div><button onClick={() => setPending(undefined)}>CANCEL</button><button className="confirm" onClick={confirm}><Check/> CONFIRM</button></div> : null}
    </div> : null}

    <div className={`adapt-controls ${attentionTargets.length ? 'has-attention' : ''}`}>
      <button className="adapt-build" onClick={() => onProcurementMode(procurementMode === 'catalog' ? 'closed' : 'catalog')}><Plus/><span>BUILD</span></button>
      {attentionTargets.length ? <button className="adapt-attention" onClick={cycleAttention}><Zap/><b>{attentionTargets.length}</b><span>NEED ATTENTION</span></button> : null}
      <button className="adapt-next" onClick={onNextRound}>BEGIN ROUND {String(match.round + 1).padStart(2, '0')} <ChevronRight/></button>
    </div>
  </section>
}
