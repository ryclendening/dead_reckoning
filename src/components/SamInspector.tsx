import { samStatusAt } from '../game/airDefense'
import type { Asset, RoundResult } from '../game/types'

export function SamInspector({asset,result,seconds,onClose}:{asset:Asset;result?:RoundResult;seconds:number;onClose:()=>void}){
  const status=samStatusAt(asset.id,result?.weaponEffects,seconds)
  const activity=asset.health<=0?'DESTROYED':asset.operational===false?'OFFLINE':status.remaining===0?'EMPTY · RELOADS NEXT ROUND':status.cooldown>.001?`READY IN ${status.cooldown.toFixed(1)}s`:'READY TO FIRE'
  return <aside className="sam-inspector" aria-label="SAM site status">
    <header><b>{asset.name??'SAM SITE'}</b><button onClick={onClose} aria-label="Close SAM status">×</button></header>
    <label>HEALTH <strong>{Math.round(asset.health)} / {asset.maxHealth}</strong></label>
    <progress value={asset.health} max={asset.maxHealth} aria-label="SAM health"/>
    <label>MISSILES THIS ROUND <strong>{status.remaining} / {status.capacity}</strong></label>
    <div className="sam-ammo" aria-label={`${status.remaining} missiles remaining`}>{Array.from({length:status.capacity},(_,index)=><i key={index} className={index<status.remaining?'loaded':''}/>)}</div>
    <p>{activity}</p><small>3s BETWEEN SHOTS · ENGAGEMENT RANGE 3.2</small>
  </aside>
}
