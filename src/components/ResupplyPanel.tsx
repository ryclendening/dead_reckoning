import { useState } from 'react'
import { Check, ChevronRight, X } from 'lucide-react'
import { economyAttentionTargets, economyCommandForQuote, economyQuotesFor, findMatchingEconomyQuote } from '../game/economy'
import { formatCash } from '../game/economyRules'
import { formationStatus } from '../game/formationStatus'
import { upgradeDefinition } from '../game/upgrades'
import { FormationChip } from './FormationChip'
import { PurchaseCatalog, type PurchaseCategory } from './PurchaseCatalog'
import { DefenseSiteDetails } from './DefenseSiteDetails'
import { assetCardData } from '../game/unitCards'
import type { EconomyActionId, EconomyActionQuote, EconomyCommand, EconomyTarget, MatchState } from '../game/types'

export type ProcurementMode = 'closed' | 'catalog' | 'placing'

const campaignTarget = { kind: 'campaign', id: 'campaign' } as const

interface ResupplyPanelProps {
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
  busy?: boolean
  cpuAdapting?: boolean
  nextRoundDisabled?: boolean
}

function PurchaseButton({ quote, onBuy, disabled }: { quote: EconomyActionQuote; onBuy: () => void; disabled?: boolean }) {
  const deployment = quote.effect.kind === 'asset-construction' ? quote.effect.deployment : undefined
  return <button type="button" disabled={disabled || !quote.eligible} onClick={onBuy}>
    <span>
      <b>{quote.label}</b>
      {deployment ? <small>{`${deployment.active}/${deployment.limit} operational`}</small> : null}
      <small>{quote.detail}</small>
      {quote.reason ? <em>{quote.reason}</em> : null}
    </span>
    <strong>{formatCash(quote.cost)}</strong>
  </button>
}

export function ResupplyPanel({
  match, selectedTarget, onSelectTarget, onCloseTarget, onPurchase, onNextRound, procurementMode,
  procurementActionId, onProcurementMode, onProcurementAction, hasPlacementPreview, onConfirmPlacement,
  onCancelPlacement, busy = false, cpuAdapting = false, nextRoundDisabled = false,
}: ResupplyPanelProps) {
  const [purchaseCategory, setPurchaseCategory] = useState<PurchaseCategory>('Aircraft')
  const [showRepairs, setShowRepairs] = useState(false)
  const [upgradePending, setUpgradePending] = useState<EconomyCommand>()
  const quotes = economyQuotesFor(match, selectedTarget)
  const catalog = economyQuotesFor(match, campaignTarget)
  const placement = catalog.find(quote => quote.id === procurementActionId && quote.effect.kind === 'asset-construction')
  const repairTargets = economyAttentionTargets(match)
  const repairIds = new Set(repairTargets.map(target => target.id))
  const friendlyAsset = selectedTarget.kind === 'asset' ? match.playerAssets.find(asset => asset.id === selectedTarget.id) : undefined
  const selectedAsset = friendlyAsset ?? (selectedTarget.kind === 'asset'
    ? match.enemyAssets.find(asset => asset.id === selectedTarget.id && !asset.hidden && asset.intel !== 'unknown')
    : undefined)
  const assetData = selectedAsset ? assetCardData(selectedAsset, !friendlyAsset, 'adapt') : undefined
  const formation = selectedTarget.kind === 'squadron' ? match.squadrons.find(item => item.id === selectedTarget.id) : undefined
  const force = formation ? formationStatus(formation) : undefined
  const repair = quotes.find(quote => quote.effect.kind === 'formation-strength')
  const installed = (selectedAsset?.upgrades ?? []).map(upgradeDefinition)
  const pending = findMatchingEconomyQuote(quotes, upgradePending)
  const hasSelection = procurementMode === 'closed' && Boolean(assetData)
  const repairsOpen = showRepairs && repairIds.size > 0 && selectedTarget.kind === 'campaign' && procurementMode === 'closed'
  const flights = match.squadrons.filter(flight => flight.aircraft > 0 && (!repairsOpen || repairIds.has(flight.id)))

  function chooseTarget(target: EconomyTarget) {
    setShowRepairs(false)
    setUpgradePending(undefined)
    onSelectTarget(target)
  }

  function buy(quote: EconomyActionQuote) {
    onPurchase(economyCommandForQuote(match, quote))
  }

  function choosePurchase(quote: EconomyActionQuote) {
    if (quote.effect.kind === 'asset-construction') onProcurementAction(quote.id)
    else buy(quote)
  }

  function chooseAction(quote: EconomyActionQuote) {
    if (quote.upgradeId) setUpgradePending(economyCommandForQuote(match, quote))
    else buy(quote)
  }

  return <section className={`phase-panel resupply-panel${procurementMode !== 'placing' && !hasSelection ? ' resupply-bar' : ''}`} aria-label="Resupply">
    <div className="resupply-content">
      {procurementMode === 'catalog' ? <PurchaseCatalog
        category={purchaseCategory} quotes={catalog} match={match} busy={busy} onCategoryChange={setPurchaseCategory}
        onChoose={choosePurchase} onClose={() => onProcurementMode('closed')}
      /> : null}

      {procurementMode === 'placing' && placement ? <div className="adapt-drawer adapt-placement-drawer" aria-label="Place site">
        <header className="adapt-build-heading"><b>{placement.label} · {formatCash(placement.cost)}</b><button type="button" aria-label="Cancel placement" onClick={() => onProcurementMode('catalog')}><X/></button></header>
        <div className="phase-panel-content">
          <p className="procure-instruction">{hasPlacementPreview ? 'Tap another hex to move.' : 'Tap a highlighted hex.'}</p>
          {hasPlacementPreview ? <div className="campaign-placement-confirm"><button type="button" onClick={onCancelPlacement}>Clear site</button><button type="button" className="confirm" disabled={busy} onClick={onConfirmPlacement}>Confirm build <Check/></button></div> : null}
        </div>
      </div> : null}

      {hasSelection && assetData ? <div className="adapt-drawer adapt-selection" aria-label="Selected system">
        <header className="adapt-drawer-title">
          <b>{assetData.title}</b>
          <small>{`${Math.round(assetData.health)} / ${assetData.maxHealth} HP`}</small>
          <button type="button" aria-label="Close selected system" onClick={() => { setUpgradePending(undefined); onCloseTarget() }}><X/></button>
        </header>
        <div className="phase-panel-content">
          {pending ? <>
            <p className="phase-panel-copy">{pending.detail}</p>
            <div className="adapt-confirm">
              <div><b>{pending.label}</b><small>{formatCash(pending.projected.logistics)} after purchase</small></div>
              <button type="button" onClick={() => setUpgradePending(undefined)}>Cancel</button>
              <button type="button" className="confirm" disabled={busy || !pending.eligible} onClick={() => { buy(pending); setUpgradePending(undefined) }}>Confirm <Check/></button>
            </div>
          </> : <>
            <progress value={assetData.health} max={assetData.maxHealth} aria-label="Site health"/>
            <p className="adapt-site-status">{friendlyAsset ? '' : 'Enemy · '}{assetData.status}</p>
            {selectedAsset ? <DefenseSiteDetails asset={selectedAsset} sites={friendlyAsset ? match.playerAssets : match.enemyAssets.filter(asset => !asset.hidden && asset.intel === 'confirmed')} enemy={!friendlyAsset}/> : null}
            {installed.map(upgrade => upgrade ? <p key={upgrade.id} className="adapt-installed"><Check/>{upgrade.label} installed</p> : null)}
            {quotes.length ? <div className="adapt-actions">{quotes.map(quote =>
              <PurchaseButton key={quote.id} quote={quote} disabled={busy} onBuy={() => chooseAction(quote)}/>
            )}</div> : null}
          </>}
        </div>
      </div> : null}
    </div>
    {procurementMode === 'closed' && !hasSelection && flights.length ? <div className="resupply-aircraft">
      {formation && force ? <div className="formation-service" aria-label="Selected aircraft">
        <div>
          <b>{formation.callsign}</b>
          <small>{force.aircraft}/{force.maxAircraft} aircraft{formation.status === 'trapped' ? ' · Trapped' : ''}</small>
          <small>{repair?.detail ?? `${Math.round(formation.strength ?? force.aircraftFraction * 100)}% strength`}</small>
        </div>
        {repair ? <button type="button" className="formation-repair" disabled={busy || !repair.eligible}
          onClick={() => buy(repair)}>Repair · {formatCash(repair.cost)}{repair.reason ? <small>{repair.reason}</small> : null}</button> : null}
        <button type="button" className="formation-dismiss" aria-label="Close selected aircraft" onClick={() => chooseTarget(campaignTarget)}><X/></button>
      </div> : null}
      <nav className="resupply-flights" aria-label={repairsOpen ? 'Formations needing repair' : 'Aircraft'}>
        {flights.map(flight => <FormationChip key={flight.id} flight={flight} cue={repairIds.has(flight.id) ? 'repair' : undefined}
          selected={formation?.id === flight.id} onSelect={() => chooseTarget(formation?.id === flight.id ? campaignTarget : { kind: 'squadron', id: flight.id })}/>)}
      </nav>
    </div> : null}
    <div className="resupply-controls phase-panel-footer">
      <span className="adapt-balance" aria-label="Cash balance"><b>{formatCash(match.logistics)}</b></span>
      <button type="button" aria-expanded={procurementMode === 'catalog'} onClick={() => {
        setShowRepairs(false)
        setUpgradePending(undefined)
        onProcurementMode(procurementMode === 'catalog' ? 'closed' : 'catalog')
      }}>Buy</button>
      {repairTargets.length ? <button type="button" aria-pressed={repairsOpen} onClick={() => {
        onCloseTarget()
        setUpgradePending(undefined)
        setShowRepairs(!repairsOpen)
      }}>Repairs <span>{repairTargets.length}</span></button> : null}
      <button type="button" className="adapt-next" aria-live="polite" disabled={busy || nextRoundDisabled} onClick={onNextRound}>{cpuAdapting ? 'CPU adapting…' : `Plan round ${match.round + 1}`} <ChevronRight/></button>
    </div>
  </section>
}
