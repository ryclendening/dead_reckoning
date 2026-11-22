import { Check, ChevronRight, X } from 'lucide-react'
import { economyCommandForQuote, economyQuotesFor } from '../game/economy'
import { formatCash } from '../game/economyRules'
import { formationStatus } from '../game/formationStatus'
import { PurchaseCatalog, type PurchaseCategory } from './PurchaseCatalog'
import type { EconomyActionId, EconomyActionQuote, EconomyCommand, EconomyTarget, MatchState } from '../game/types'

export type ProcurementMode = 'closed' | 'catalog' | 'placing'

const campaignTarget = { kind: 'campaign', id: 'campaign' } as const

interface ResupplyPanelProps {
  match: MatchState
  selectedTarget: EconomyTarget
  onCloseTarget: () => void
  onPurchase: (command: EconomyCommand) => void
  onNextRound: () => void
  procurementMode: ProcurementMode
  purchaseCategory: PurchaseCategory
  onPurchaseCategoryChange: (category: PurchaseCategory) => void
  procurementActionId?: EconomyActionId
  onProcurementMode: (mode: ProcurementMode) => void
  onProcurementAction: (actionId: EconomyActionId) => void
  hasPlacementPreview: boolean
  onConfirmPlacement: () => void
  onCancelPlacement: () => void
  busy?: boolean
  cpuAdapting?: boolean
  nextRoundDisabled?: boolean
}

export function ResupplyPanel({
  match, selectedTarget, onCloseTarget, onPurchase, onNextRound, procurementMode, purchaseCategory, onPurchaseCategoryChange,
  procurementActionId, onProcurementMode, onProcurementAction, hasPlacementPreview, onConfirmPlacement,
  onCancelPlacement, busy = false, cpuAdapting = false, nextRoundDisabled = false,
}: ResupplyPanelProps) {
  const catalog = economyQuotesFor(match, campaignTarget)
  const placement = catalog.find(quote => quote.id === procurementActionId && quote.effect.kind === 'asset-construction')
  const formation = selectedTarget.kind === 'squadron' ? match.squadrons.find(item => item.id === selectedTarget.id) : undefined
  const force = formation ? formationStatus(formation) : undefined
  const repair = formation ? economyQuotesFor(match, selectedTarget).find(quote => quote.effect.kind === 'formation-strength') : undefined

  function buy(quote: EconomyActionQuote) {
    onPurchase(economyCommandForQuote(match, quote))
  }

  function choosePurchase(quote: EconomyActionQuote) {
    if (quote.effect.kind === 'asset-construction') onProcurementAction(quote.id)
    else buy(quote)
  }

  return <section className={`phase-panel resupply-panel${procurementMode !== 'placing' ? ' resupply-bar' : ''}`} aria-label="Resupply">
    <div className="resupply-content">
      {procurementMode === 'catalog' ? <PurchaseCatalog
        category={purchaseCategory} quotes={catalog} match={match} busy={busy} onCategoryChange={onPurchaseCategoryChange}
        onChoose={choosePurchase} onClose={() => onProcurementMode('closed')}
      /> : null}

      {procurementMode === 'placing' && placement ? <div className="adapt-drawer adapt-placement-drawer" aria-label="Place site">
        <header className="adapt-build-heading"><b>{placement.label} · {formatCash(placement.cost)}</b><button type="button" aria-label="Cancel placement" onClick={() => onProcurementMode('catalog')}><X/></button></header>
        <div className="phase-panel-content">
          <p className="procure-instruction">{hasPlacementPreview ? 'Tap another hex to move.' : 'Tap a highlighted hex.'}</p>
          {hasPlacementPreview ? <div className="campaign-placement-confirm"><button type="button" onClick={onCancelPlacement}>Clear site</button><button type="button" className="confirm" disabled={busy} onClick={onConfirmPlacement}>Confirm build <Check/></button></div> : null}
        </div>
      </div> : null}
    </div>
    {procurementMode === 'closed' && formation && force ? <div className="resupply-aircraft">
      <div className="formation-service" aria-label="Selected aircraft">
        <div>
          <b>{formation.callsign}</b>
          <small>{force.aircraft}/{force.maxAircraft} aircraft{formation.status === 'trapped' ? ' · Trapped' : ''}</small>
          <small>{repair?.detail ?? `${Math.round(formation.strength ?? force.aircraftFraction * 100)}% strength`}</small>
        </div>
        {repair ? <button type="button" className="formation-repair" disabled={busy || !repair.eligible}
          onClick={() => buy(repair)}>Repair · {formatCash(repair.cost)}{repair.reason ? <small>{repair.reason}</small> : null}</button> : null}
        <button type="button" className="formation-dismiss" aria-label="Close selected aircraft" onClick={onCloseTarget}><X/></button>
      </div>
    </div> : null}
    <div className="resupply-controls phase-panel-footer">
      <span className="adapt-balance" aria-label="Cash balance"><b>{formatCash(match.logistics)}</b></span>
      <button type="button" aria-expanded={procurementMode === 'catalog'} onClick={() => onProcurementMode(procurementMode === 'catalog' ? 'closed' : 'catalog')}>Buy</button>
      <button type="button" className="adapt-next" aria-live="polite" disabled={busy || nextRoundDisabled} onClick={onNextRound}>{cpuAdapting ? 'CPU adapting…' : `Plan round ${match.round + 1}`} <ChevronRight/></button>
    </div>
  </section>
}
