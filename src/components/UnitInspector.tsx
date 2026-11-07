import type { ReactNode } from 'react'
import { samStatusForPhase } from '../game/airDefense'
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

export function AssetInspector({asset,phase,result,seconds,enemy=false,onClose}:{asset:Asset;phase:Phase;result?:RoundResult;seconds:number;enemy?:boolean;onClose:()=>void}){
  const data=assetCardData(asset,enemy,phase,result,seconds)
  if(!data)return null
  const sam=asset.kind==='sam'?samStatusForPhase(asset.id,phase,result?.weaponEffects,seconds):undefined
  const activity=asset.health<=0?'DESTROYED':asset.operational===false?'OFFLINE':sam?.remaining===0?'EMPTY · RELOADS NEXT ROUND':sam&&sam.cooldown>.001?`READY IN ${sam.cooldown.toFixed(1)}s`:phase==='adapt'?'REARMED FOR NEXT ROUND':'READY TO FIRE'
  return <UnitInspector data={data} enemy={enemy} onClose={onClose}>
    {sam?<><label>{phase==='debrief'?'MISSILES AT ROUND END':'MISSILES THIS ROUND'} <strong>{sam.remaining} / {sam.capacity}</strong></label><div className="sam-ammo" aria-label={`${sam.remaining} missiles remaining`}>{Array.from({length:sam.capacity},(_,index)=><i key={index} className={index<sam.remaining?'loaded':''}/>)}</div><p>{activity}</p><small>3s BETWEEN SHOTS · ENGAGEMENT RANGE 3.2</small></>:null}
    {asset.kind==='radar'?<small>DETECTION RANGE 6.4</small>:asset.kind==='aaa'?<small>ENGAGEMENT RANGE 1.9 · ONE SHOT PER FLIGHT PER ROUND</small>:asset.kind==='base'||asset.kind==='fob'?<label>BASED FORMATIONS <strong>{asset.basedFormationIds?.length??0}{asset.kind==='fob'?` / ${asset.capacity??2}`:''}</strong></label>:null}
  </UnitInspector>
}

export function AircraftInspector({flight,frame,visibility,trackId,onClose}:{flight:Squadron|EnemyFlight;frame:UnitFrame;visibility:'friendly'|'visual'|'radar';trackId?:string;onClose:()=>void}){
  const data=aircraftCardData(flight,frame,visibility,trackId)
  return data?<UnitInspector data={data} enemy={visibility==='visual'} onClose={onClose}>{visibility==='friendly'?<label>MORALE <strong>{Math.round(frame.morale)}</strong></label>:null}</UnitInspector>:null
}
