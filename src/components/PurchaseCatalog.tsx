import { useEffect, useId, useRef, useState } from 'react'
import { Bomb, Check, ChevronRight, Crosshair, Eye, LockKeyhole, Package, Radar, RadioTower, Rocket, Warehouse, Wrench, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { economyQuotesFor } from '../game/economy'
import { formatCash } from '../game/economyRules'
import type { EconomyActionQuote, MatchState } from '../game/types'
import { UPGRADE_CATALOG } from '../game/upgrades'
import './PurchaseCatalog.css'

const categories = ['Aircraft', 'Ground', 'Upgrades'] as const
export type PurchaseCategory = typeof categories[number]

const aircraft = {
  fighter: { label: 'Fighter', icon: Crosshair },
  recon: { label: 'Recon', icon: Eye },
  bomber: { label: 'Bomber', icon: Bomb },
}

const ground = {
  fob: { label: 'Forward base', icon: Warehouse },
  decoy: { label: 'Decoy', icon: RadioTower },
  aaa: { label: 'AAA', icon: Crosshair },
  sam: { label: 'SAM', icon: Rocket },
  radar: { label: 'Radar', icon: Radar },
}

const upgradeIcons: Readonly<Record<string, LucideIcon>> = {
  'maintenance-wing': Wrench,
  'supply-depot': Package,
}

interface Offer {
  id: string
  label: string
  icon: LucideIcon
  cost: number
  detail: string
  quote?: EconomyActionQuote
  installed?: boolean
  reason?: string
  deployment?: string
}

function upgradeOffers(match: MatchState): Offer[] {
  const base = match.playerAssets.find(asset => asset.kind === 'base')
  const quotes = base ? economyQuotesFor(match, { kind: 'asset', id: base.id }) : []
  const installed = base?.upgrades ?? []
  return UPGRADE_CATALOG.filter(upgrade => upgrade.targets.includes('base')).map(upgrade => {
    const quote = quotes.find(item => item.upgradeId === upgrade.id)
    const isInstalled = installed.includes(upgrade.id)
    return {
      id: upgrade.id, label: upgrade.label.toLowerCase(), icon: upgradeIcons[upgrade.id] ?? Wrench,
      cost: upgrade.cost, detail: upgrade.detail, quote, installed: isInstalled,
      reason: quote?.reason ?? (!quote && !isInstalled
        ? base ? 'Airfield upgrade slot filled' : 'Main airfield unavailable'
        : undefined),
    }
  })
}

function storeOffers(category: PurchaseCategory, quotes: EconomyActionQuote[], match: MatchState): Offer[] {
  if (category === 'Upgrades') return upgradeOffers(match)
  return quotes.flatMap(quote => {
    const effect = quote.effect
    if (category === 'Aircraft' && effect.kind === 'formation-purchase') return [{
      ...aircraft[effect.role], id: quote.id, cost: quote.cost, quote, reason: quote.reason,
      detail: '4 aircraft · Home base next round',
    }]
    if (category === 'Ground' && effect.kind === 'asset-construction') return [{
      ...ground[effect.assetKind], id: quote.id, cost: quote.cost, quote, reason: quote.reason, detail: quote.detail,
      deployment: effect.deployment ? `${effect.deployment.active}/${effect.deployment.limit} operational` : undefined,
    }]
    return []
  })
}

export function PurchaseCatalog({ category, quotes, match, busy, onCategoryChange, onChoose, onClose }: {
  category: PurchaseCategory
  quotes: EconomyActionQuote[]
  match: MatchState
  busy: boolean
  onCategoryChange: (category: PurchaseCategory) => void
  onChoose: (quote: EconomyActionQuote) => void
  onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const title = useId()
  const receipt = useId()
  const [selectedIds, setSelectedIds] = useState<Partial<Record<PurchaseCategory, string>>>({})
  const [receiptOpen, setReceiptOpen] = useState(false)
  const offers = storeOffers(category, quotes, match)
  const selected = offers.find(offer => offer.id === selectedIds[category])
    ?? offers.find(offer => offer.installed) ?? offers[0]
  const purchases = match.economy.statement.filter(entry => entry.round === match.round && entry.direction === 'spend')
  const spent = purchases.reduce((sum, entry) => sum + entry.amount, 0)
  const quote = selected?.quote
  const action = category === 'Ground' ? 'Place' : category === 'Upgrades' ? 'Install' : 'Buy'
  const showUpgrades = category === 'Upgrades'

  useEffect(() => {
    const store = dialog.current
    store?.showModal()
    return () => { store?.close() }
  }, [])

  return <dialog ref={dialog} className="resupply-store" aria-labelledby={title} onCancel={event => { event.preventDefault(); onClose() }}>
    <header className="store-heading">
      <h2 id={title}>Resupply</h2>
      <strong aria-label="Cash balance" aria-live="polite">{formatCash(match.logistics)}</strong>
      <button type="button" aria-label="Close store" onClick={onClose}><X/></button>
    </header>
    <div className="store-tabs" role="group" aria-label="Purchase type">
      {categories.map(item => <button type="button" key={item} aria-pressed={!receiptOpen && category === item} onClick={() => {
        setReceiptOpen(false)
        onCategoryChange(item)
      }}>{item}</button>)}
    </div>
    <div className="store-body">
      <div className="store-stage">
        {receiptOpen ? <section className="store-receipt" id={receipt} aria-label="This round's purchases">
          <h3>Purchases</h3>
          <ul>{purchases.map(entry => <li key={entry.id}><span>{entry.label.toLowerCase()}</span><strong>{formatCash(entry.amount)}</strong></li>)}</ul>
        </section> : <div className={showUpgrades ? 'store-upgrades' : 'store-catalog'}>
          {showUpgrades ? <>
            <div className="store-root"><Warehouse aria-hidden="true"/><b>Main airfield</b></div>
            <svg className="store-fork" viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true">
              <path d="M50 0V12 M25 24V12H75V24" fill="none" vectorEffect="non-scaling-stroke"/>
            </svg>
          </> : null}
          <div className="store-offers" role="group" aria-label={category}>
            {offers.map(offer => <button key={offer.id} type="button" className="store-offer"
              data-status={offer.installed ? 'installed' : offer.reason ? 'locked' : undefined}
              aria-pressed={offer.id === selected?.id} onClick={() =>
                setSelectedIds(ids => ({ ...ids, [category]: offer.id }))
              }>
              <span className="store-offer-icon"><offer.icon aria-hidden="true"/></span>
              <span className="store-offer-label">
                <b>{offer.label}</b>
                {offer.deployment ? <small>{offer.deployment}</small> : null}
              </span>
              <span className="store-offer-price">
                {offer.installed ? <Check aria-hidden="true"/> : offer.reason ? <LockKeyhole aria-hidden="true"/> : null}
                {offer.installed ? 'Installed' : offer.quote ? formatCash(offer.cost) : 'Locked'}
              </span>
            </button>)}
          </div>
        </div>}
      </div>
      <footer className="store-footer">
        {selected && !receiptOpen ? <div className="store-selection">
          <h3>{selected.label}</h3>
          {quote ? <button type="button" className="store-action" disabled={busy || !quote.eligible} onClick={() => onChoose(quote)}>
            {action} · {formatCash(quote.cost)}
          </button> : selected.installed ? <span className="store-installed"><Check aria-hidden="true"/> Installed</span> : null}
          <p>{selected.detail}</p>
          {selected.reason ? <p className="store-reason">{selected.reason.toLowerCase()}</p> : null}
        </div> : null}
        {purchases.length ? <button type="button" className="store-round" aria-expanded={receiptOpen} aria-controls={receiptOpen ? receipt : undefined} onClick={() => setReceiptOpen(!receiptOpen)}>
          <b>This round</b>
          <span aria-live="polite">{purchases.length} {purchases.length === 1 ? 'purchase' : 'purchases'} · {formatCash(spent)}</span>
          <ChevronRight aria-hidden="true"/>
        </button> : <div className="store-round"><b>This round</b><span>No purchases yet</span></div>}
      </footer>
    </div>
  </dialog>
}
