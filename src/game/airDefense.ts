import type { Phase, WeaponEffect } from './types'

export const SAM_MISSILES_PER_ROUND = 3
export const SAM_COOLDOWN_SECONDS = 3

/** Launch history is the ammunition ledger, including misses and missiles still in flight. */
export function samStatusAt(assetId:string,effects:readonly WeaponEffect[]=[],seconds=0){
  const shots=effects.filter(effect=>effect.kind==='sam'&&effect.sourceId===assetId&&effect.start<=seconds+.000001)
  const last=shots.reduce((latest,effect)=>Math.max(latest,effect.start),-Infinity)
  return {capacity:SAM_MISSILES_PER_ROUND,remaining:Math.max(0,SAM_MISSILES_PER_ROUND-shots.length),cooldown:Math.max(0,last+SAM_COOLDOWN_SECONDS-seconds)}
}

/** Debrief preserves the completed salvo; between-round planning shows the replenished rack. */
export function samStatusForPhase(assetId:string,phase:Phase,effects:readonly WeaponEffect[]=[],seconds=0){
  return samStatusAt(assetId,phase==='execute'||phase==='debrief'?effects:[],seconds)
}
