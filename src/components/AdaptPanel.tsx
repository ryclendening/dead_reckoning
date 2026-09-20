import { useEffect, useMemo, useState } from 'react'
import { Check, ChevronRight, MapPin, Plus, Wrench, X, Zap } from 'lucide-react'
import { economyAttentionTargets, economyCommandForQuote, economyQuotesFor, findMatchingEconomyQuote, validateAssetPlacement } from '../game/economy'
import type { EconomyActionId, EconomyActionQuote, EconomyCommand, EconomyTarget, MatchState, Point } from '../game/types'

export type ProcurementMode = 'closed' | 'catalog' | 'placing'

interface AdaptPanelProps {
  match: MatchState
  selectedTarget: EconomyTarget
  onSelectTarget: (target: EconomyTarget) => void
  onPurchase: (command: EconomyCommand) => void
  onNextRound: () => void
  procurementMode: ProcurementMode
  procurementActionId?: EconomyActionId
  procurementPlacement?: Point
  onProcurementMode: (mode: ProcurementMode) => void
  onProcurementAction: (actionId: EconomyActionId) => void
}

const targetLabel = (match: MatchState, target: EconomyTarget) => target.kind === 'campaign' ? 'CAMPAIGN' : target.kind === 'squadron'
  ? match.squadrons.find(item => item.id === target.id)?.callsign ?? 'FORMATION'
  : match.playerAssets.find(item => item.id === target.id)?.kind === 'base' ? 'MAIN AIRFIELD' : (match.playerAssets.find(item => item.id === target.id)?.name ?? match.playerAssets.find(item => item.id === target.id)?.kind ?? 'ASSET').toUpperCase()

const targetKey = (target: EconomyTarget) => `${target.kind}:${target.id}`
const isRoutineRepair = (quote: EconomyActionQuote) => quote.id === 'repair-formation' || quote.id === 'repair-defense' || quote.id === 'repair-fob'

export function AdaptPanel({ match, selectedTarget, onSelectTarget, onPurchase, onNextRound, procurementMode, procurementActionId, procurementPlacement, onProcurementMode, onProcurementAction }: AdaptPanelProps) {
  const [pending, setPending] = useState<EconomyActionQuote>()
  const quotes = [...economyQuotesFor(match, selectedTarget)].sort((left, right) => Number(right.id === 'replace-aircraft') - Number(left.id === 'replace-aircraft'))
  const attentionTargets = useMemo(() => economyAttentionTargets(match), [match])
  const procurementQuotes = economyQuotesFor(match, { kind: 'campaign', id: 'campaign' }).filter(quote => quote.effect.kind === 'asset-construction')
  const procurementQuote = procurementQuotes.find(item => item.id === procurementActionId)
  const procurementKind = procurementQuote?.effect.kind === 'asset-construction' ? procurementQuote.effect.assetKind : undefined
  const placement = procurementKind ? validateAssetPlacement(match, procurementKind, procurementPlacement) : { valid: false, reason: 'SELECT AN ASSET' }
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
  const confirmProcurement = () => {
    if (!procurementQuote?.eligible || !procurementPlacement || !placement.valid) return
    onPurchase({ ...economyCommandForQuote(match, procurementQuote), placement: procurementPlacement })
    onProcurementMode('closed')
  }

  return <section className="adapt-panel" aria-label="Adapt force turnaround">
    <div className={`procure-float mode-${procurementMode}`}>
      {procurementMode === 'catalog' ? <div className="procure-card" role="dialog" aria-label="Build catalog"><header><span><Plus/> BUILD</span><button aria-label="Close build catalog" onClick={() => onProcurementMode('closed')}><X/></button></header><div className="procure-catalog">{procurementQuotes.map(quote => <button key={quote.id} className="procure-option" disabled={!quote.eligible} onClick={() => quote.eligible && onProcurementAction(quote.id)}><MapPin/><span><b>{quote.effect.kind === 'asset-construction' ? quote.effect.assetKind.toUpperCase() : quote.label}</b><small>{quote.detail}</small>{quote.reason ? <em>{quote.reason}</em> : null}</span><strong>{quote.cost} L</strong></button>)}</div></div> : null}
      {procurementMode === 'placing' ? <div className="procure-card placing" role="dialog" aria-label={`Place ${procurementKind ?? 'asset'}`}><header><span><MapPin/> PLACE {procurementKind?.toUpperCase() ?? 'ASSET'}</span><button aria-label="Cancel placement" onClick={() => onProcurementMode('closed')}><X/></button></header><div className={`procure-site ${procurementPlacement ? placement.valid ? 'valid' : 'invalid' : ''}`}><b>{procurementPlacement ? placement.valid ? 'VALID SITE' : 'INVALID SITE' : 'TAP THE MAP TO PLACE'}</b><small>{procurementPlacement ? placement.valid ? `${procurementPlacement[0].toFixed(1)}, ${procurementPlacement[1].toFixed(1)} · RECOVERED TERRITORY` : placement.reason : 'Choose a location inside friendly or recovered territory.'}</small></div><div className="procure-actions"><button onClick={() => onProcurementMode('catalog')}>BACK</button><button className="confirm" disabled={!procurementQuote?.eligible || !placement.valid} onClick={confirmProcurement}><Check/> CONFIRM {procurementQuote?.cost ?? 0} L</button></div></div> : null}
    </div>

    <header className="adapt-heading"><div><small>ROUND {String(match.round).padStart(2, '0')} · ADAPT</small><h2>FORCE TURNAROUND</h2></div><div className="adapt-balance"><Wrench/><b>{match.logistics}</b><small>LOGISTICS · {match.replacements} RESERVE</small></div></header>
    <details className="adapt-income"><summary>+{roundIncome} THIS ROUND</summary><div>{match.economy.statement.map(entry => <span key={entry.id} className={entry.direction}><b>{entry.direction === 'income' ? '+' : '-'}{entry.amount}</b><small>{entry.label}</small></span>)}</div></details>

    <div className="adapt-drawer">
      <div className="adapt-drawer-title"><span>SELECTED</span><b>{targetLabel(match, selectedTarget)}</b>{selectedSquadron ? <small>{selectedSquadron.aircraft}/{selectedSquadron.maxAircraft} AIRCRAFT · {Math.round(selectedSquadron.strength ?? 0)}%</small> : null}</div>
      {selectedAsset?.kind === 'fob' ? <p className="adapt-empty"><b>{selectedAsset.operational ? 'OPERATIONAL' : 'UNUSABLE'}</b> · CAPACITY {selectedAsset.basedFormationIds?.length ?? 0}/{selectedAsset.capacity ?? 1} · {(selectedAsset.basedFormationIds??[]).map(id=>match.squadrons.find(squadron=>squadron.id===id)?.callsign??id).join(', ')||'NO FORMATIONS BASED'}</p> : null}
      {quotes.length ? <div className="adapt-actions">{quotes.map((quote, index) => <button key={quote.id} disabled={!quote.eligible} className={`${selected?.id === quote.id ? 'selected' : ''} ${index === 0 ? 'primary' : ''}`} onClick={() => choose(quote)}><span><b>{quote.label}</b><small>{quote.detail}</small>{!quote.eligible && quote.reason ? <em>{quote.reason}</em> : null}</span><strong>{quote.cost} L{quote.reserveCost ? ` + ${quote.reserveCost} R` : ''}</strong></button>)}</div> : selectedAsset?.kind !== 'fob' ? <p className="adapt-empty">No action required. Select an asset on the map or cycle Needs Attention.</p> : null}
      {selected ? <div className="adapt-confirm"><div><b>CONFIRM {selected.label}</b><small>{selected.projected.logistics} LOGISTICS · {selected.projected.reserveAircraft} RESERVE REMAIN</small></div><button onClick={() => setPending(undefined)}>CANCEL</button><button className="confirm" onClick={confirm}><Check/> CONFIRM</button></div> : null}
    </div>

    <div className="adapt-controls">
      <button className="adapt-build" onClick={() => onProcurementMode(procurementMode === 'catalog' ? 'closed' : 'catalog')}><Plus/><span>BUILD</span></button>
      <button className="adapt-attention" disabled={!attentionTargets.length} onClick={cycleAttention}><Zap/><b>{attentionTargets.length}</b><span>NEED ATTENTION</span></button>
      <button className="adapt-next" onClick={onNextRound}>BEGIN ROUND {String(match.round + 1).padStart(2, '0')} <ChevronRight/></button>
    </div>
  </section>
}
