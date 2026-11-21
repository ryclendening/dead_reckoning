import { useState } from 'react'
import { Check, ChevronRight, X } from 'lucide-react'
import { economyAttentionTargets, economyCommandForQuote, economyQuotesFor, findMatchingEconomyQuote } from '../game/economy'
import { formatCash } from '../game/economyRules'
import { upgradeDefinition } from '../game/upgrades'
import { PanelPages } from './PanelPages'
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
  const friendlyAsset = selectedTarget.kind === 'asset' ? match.playerAssets.find(asset => asset.id === selectedTarget.id) : undefined
  const selectedAsset = friendlyAsset ?? (selectedTarget.kind === 'asset'
    ? match.enemyAssets.find(asset => asset.id === selectedTarget.id && !asset.hidden && asset.intel !== 'unknown')
    : undefined)
  const assetData = selectedAsset ? assetCardData(selectedAsset, !friendlyAsset, 'adapt') : undefined
  const formation = selectedTarget.kind === 'squadron' ? match.squadrons.find(item => item.id === selectedTarget.id) : undefined
  const based = friendlyAsset ? match.squadrons.filter(item => friendlyAsset.basedFormationIds?.includes(item.id) && item.aircraft > 0) : []
  const installed = (formation?.upgrades ?? selectedAsset?.upgrades ?? []).map(upgradeDefinition)
  const pending = findMatchingEconomyQuote(quotes, upgradePending)
  const hasSelection = procurementMode === 'closed' && Boolean(assetData || formation)
  const repairsOpen = showRepairs && selectedTarget.kind === 'campaign' && procurementMode === 'closed'

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

  return <section className={`phase-panel resupply-panel${procurementMode!=='placing'&&!hasSelection&&!repairsOpen?' resupply-bar':''}`} aria-label="Resupply">
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

      {repairsOpen ? <div className="adapt-drawer" aria-label="Formations needing repair">
        <header className="adapt-build-heading"><b>Repairs</b><button type="button" aria-label="Close repair list" onClick={() => setShowRepairs(false)}><X/></button></header>
        <div className="phase-panel-content"><PanelPages pageSize={2} label="Repairs" className="adapt-actions">{repairTargets.map(target => {
          const aircraft = match.squadrons.find(item => item.id === target.id)
          const repair = economyQuotesFor(match, target).find(quote => quote.id.startsWith('repair-'))
          return <button type="button" key={target.id} onClick={() => chooseTarget(target)}>
            <span><b>{aircraft?.callsign}</b><small>{repair?.detail}</small></span>
            {repair ? <strong>{formatCash(repair.cost)}</strong> : null}
          </button>
        })}</PanelPages></div>
      </div> : null}

      {hasSelection ? <div className="adapt-drawer adapt-selection" aria-label="Selected system">
        <header className="adapt-drawer-title">
          <b>{assetData?.title ?? formation?.callsign}</b>
          <small>{assetData ? `${Math.round(assetData.health)} / ${assetData.maxHealth} HP` : `${formation!.aircraft}/${formation!.maxAircraft} aircraft · ${Math.round(formation!.strength ?? 0)}%`}</small>
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
            {assetData ? <><progress value={assetData.health} max={assetData.maxHealth} aria-label="Site health"/>
              <p className="adapt-site-status">{friendlyAsset ? '' : 'Enemy · '}{assetData.status}</p></> : null}
            {selectedAsset ? <DefenseSiteDetails asset={selectedAsset} sites={friendlyAsset ? match.playerAssets : match.enemyAssets.filter(asset => !asset.hidden && asset.intel === 'confirmed')} enemy={!friendlyAsset}/> : null}
            {based.length ? <select className="adapt-based-picker" aria-label="Based formations" value="" onChange={event => chooseTarget({kind:'squadron',id:event.target.value})}>
              <option value="" disabled>Based here ({based.length})</option>
              {based.map(item => <option key={item.id} value={item.id}>{item.callsign} · {item.aircraft}/{item.maxAircraft}</option>)}
            </select> : null}
            {installed.map(upgrade => upgrade ? <p key={upgrade.id} className="adapt-installed"><Check/>{upgrade.label} installed</p> : null)}
            {quotes.length ? <div className="adapt-actions">{quotes.map(quote =>
              <PurchaseButton key={quote.id} quote={quote} disabled={busy} onBuy={() => chooseAction(quote)}/>
            )}</div> : null}
          </>}
        </div>
      </div> : null}
    </div>
    <div className="resupply-controls phase-panel-footer">
      <span className="adapt-balance" aria-label="Cash balance"><b>{formatCash(match.logistics)}</b></span>
      <button type="button" aria-expanded={procurementMode === 'catalog'} onClick={() => {
        setShowRepairs(false)
        setUpgradePending(undefined)
        onProcurementMode(procurementMode === 'catalog' ? 'closed' : 'catalog')
      }}>Buy</button>
      {repairTargets.length ? <button type="button" aria-expanded={repairsOpen} onClick={() => {
        onCloseTarget()
        setUpgradePending(undefined)
        setShowRepairs(!repairsOpen)
      }}>Repairs <span>{repairTargets.length}</span></button> : null}
      <button type="button" className="adapt-next" aria-live="polite" disabled={busy || nextRoundDisabled} onClick={onNextRound}>{cpuAdapting ? 'CPU adapting…' : `Plan round ${match.round + 1}`} <ChevronRight/></button>
    </div>
  </section>
}
