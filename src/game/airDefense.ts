import type { Asset, Phase, WeaponEffect } from './types'
import { defenseProfile } from './equipmentRules'

export const SAM_MISSILES_PER_ROUND = 3
export const SAM_COOLDOWN_SECONDS = 3

/** Launch history is the ammunition ledger, including misses and missiles still in flight. */
export function samStatusAt(assetId:string,effects:readonly WeaponEffect[]=[],seconds=0,asset?:Asset){
  const capacity=Math.max(0,Math.floor(asset?defenseProfile(asset)?.magazine??SAM_MISSILES_PER_ROUND:SAM_MISSILES_PER_ROUND))
  const cooldownSeconds=asset?defenseProfile(asset)?.cooldown??SAM_COOLDOWN_SECONDS:SAM_COOLDOWN_SECONDS
  const shots=effects.filter(effect=>effect.kind==='sam'&&effect.sourceId===assetId&&effect.start<=seconds+.000001)
  const last=shots.reduce((latest,effect)=>Math.max(latest,effect.start),-Infinity)
  return {capacity,remaining:Math.max(0,capacity-shots.length),cooldown:Math.max(0,last+cooldownSeconds-seconds)}
}

/** Debrief preserves the completed salvo; between-round planning shows the replenished rack. */
export function samStatusForPhase(assetId:string,phase:Phase,effects:readonly WeaponEffect[]=[],seconds=0,asset?:Asset){
  return samStatusAt(assetId,phase==='execute'||phase==='debrief'?effects:[],seconds,asset)
}
