import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { coverageSurveyFor, isDefenseSite } from '../game/defenseIntel'
import { samStatusForPhase } from '../game/airDefense'
import { effectiveDefenseProfile, radarRange } from '../game/equipmentRules'
import { upgradeDefinition } from '../game/upgrades'
import { formatDefenseRange } from './DefenseSiteDetails'
import { aircraftCardData, assetCardData, type UnitCardData } from '../game/unitCards'
import type { Asset, EnemyFlight, Phase, RoundResult, Squadron, UnitFrame } from '../game/types'

export function UnitInspector({data,onClose,children,enemy=false}:{data:UnitCardData;enemy?:boolean;onClose:()=>void;children?:ReactNode}){
  return <aside className={`unit-inspector ${enemy?'hostile':''}`} aria-label="Unit status">
    <header><div><b>{data.title}</b><small>{data.subtitle}</small></div><button onClick={onClose} aria-label="Close unit status">×</button></header>
    <label>HEALTH <strong>{Math.round(data.health)} / {data.maxHealth}</strong></label>
    <progress value={data.health} max={data.maxHealth} aria-label="Unit health"/>
    <p>{data.status}</p>{data.detail?<small>{data.detail}</small>:null}{children}
  </aside>
}

interface AssetInspectorProps {
  asset: Asset
  sites?: readonly Asset[]
  phase: Phase
  result?: RoundResult
  seconds: number
  enemy?: boolean
  onClose: () => void
  onUpgrades?: () => void
}

function siteReadout({ asset, sites = [], phase, result, seconds, enemy }: AssetInspectorProps): string {
  if (asset.health <= 0) return 'Destroyed'
  if (asset.operational === false) return 'Offline'
  if (enemy && asset.intel !== 'confirmed') return 'Unconfirmed site'
  if (enemy) {
    if (!isDefenseSite(asset)) return 'Confirmed site'
    const survey = coverageSurveyFor(asset)
    if (!survey) return 'Survey Pod required for range'
    const label = asset.kind === 'radar' ? 'Scan' : asset.kind === 'sam' ? 'Local range' : 'Range'
    return `${label} ${formatDefenseRange(survey.range)} · Surveyed R${survey.round}`
  }

  if (asset.kind === 'radar') {
    const range = formatDefenseRange(radarRange(asset))
    const linked = sites.filter(site => effectiveDefenseProfile(site, sites)?.radarLinks.some(radar => radar.id === asset.id)).length
    return `Scan ${range} · ${linked} linked`
  }

  const defense = effectiveDefenseProfile(asset, sites)
  if (defense) {
    const range = formatDefenseRange(defense.range)
    const guided = defense.radarLinks.length > 0
    if (asset.kind === 'sam') {
      const sam = samStatusForPhase(asset.id, phase, result?.weaponEffects, seconds, asset)
      const inventory = `${sam.remaining}/${sam.capacity} missiles`
      if (phase === 'debrief') return `${inventory} at round end`
      if (sam.remaining === 0) return 'Out of missiles · Reloads next round'
      if (sam.cooldown > .001) return `${inventory} · Ready in ${sam.cooldown.toFixed(1)}s`
      return `${inventory} · ${guided ? 'Radar guided' : `Range ${range}`}`
    }
    return `Range ${range}${guided ? ' · Radar linked' : ''}`
  }

  if (asset.kind === 'fob') return `${asset.basedFormationIds?.length ?? 0}/${asset.capacity ?? 2} formations based`
  if (asset.kind === 'base') {
    const upgrade = asset.upgrades?.map(upgradeDefinition).find(Boolean)
    return upgrade?.label ?? `${asset.basedFormationIds?.length ?? 0} formations based`
  }
  return 'Decoy runway'
}

export function AssetInspector(props: AssetInspectorProps) {
  const { asset, enemy, onClose, onUpgrades } = props
  const data = assetCardData(asset, enemy)
  if (!data) return null
  const summary = siteReadout(props)
  return <aside className="site-readout" data-enemy={Boolean(enemy)} aria-label="Selected ground site">
    <div className="site-readout-body">
      <div className="site-readout-heading">
        <b title={data.title}>{data.title}</b>
        <strong>{Math.round(data.health)}/{data.maxHealth} HP</strong>
      </div>
      <progress className="site-health" value={data.health} max={data.maxHealth} aria-label="Site health"/>
      <small title={summary}>{summary}</small>
    </div>
    {onUpgrades ? <button type="button" className="site-upgrade-action" onClick={onUpgrades}>Upgrades</button> : null}
    <button type="button" className="site-readout-dismiss" onClick={onClose} aria-label="Close ground site"><X aria-hidden="true"/></button>
  </aside>
}

export function AircraftInspector({flight,frame,visibility,trackId,onClose}:{flight:Squadron|EnemyFlight;frame:UnitFrame;visibility:'friendly'|'visual'|'radar';trackId?:string;onClose:()=>void}){
  const data=aircraftCardData(flight,frame,visibility,trackId)
  return data?<UnitInspector data={data} enemy={visibility==='visual'} onClose={onClose}>{visibility==='friendly'?<label>MORALE <strong>{Math.round(frame.morale)}</strong></label>:null}</UnitInspector>:null
}
