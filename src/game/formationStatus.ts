import type { ExecutionStatus, Squadron } from './types'

/**
 * The compact status model used by staging and planning surfaces.
 *
 * `aircraft` is deliberately derived from the authoritative squadron count;
 * readiness and ammunition describe sortie condition but never substitute for
 * aircraft strength.
 */
export interface FormationStatus {
  aircraft: number
  maxAircraft: number
  aircraftFraction: number
  destroyed: boolean
  readiness: number
  ammo: number
  damaged: number
  status?: ExecutionStatus
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

export function recoveryReasonLabel(reason?:string){
  switch(reason){
    case 'fuel-reserve':return 'FUEL RESERVE'
    case 'world-edge':return 'WORLD EDGE'
    case 'player-rtb':case 'recovery-commanded':return 'PLAYER RTB ORDER'
    case 'recovery-field-unusable':return 'AIRFIELD DIVERSION'
    case 'protected-flight-ended':return 'ESCORT COMPLETE'
    case 'route-complete':case 'mission-unavailable':return 'ROUTE COMPLETE'
    default:return 'RECOVERY REQUIRED'
  }
}

export function formationStatus(squadron: Pick<Squadron, 'aircraft' | 'maxAircraft' | 'damaged' | 'readiness' | 'ammo' | 'status'>): FormationStatus {
  const maxAircraft = Math.max(0, Math.round(squadron.maxAircraft))
  const aircraft = clamp(Math.round(squadron.aircraft), 0, maxAircraft)
  return {
    aircraft,
    maxAircraft,
    aircraftFraction: maxAircraft === 0 ? 0 : aircraft / maxAircraft,
    destroyed: aircraft === 0 || squadron.status === 'destroyed',
    readiness: clamp(Math.round(squadron.readiness), 0, 100),
    ammo: clamp(Math.round(squadron.ammo), 0, 100),
    damaged: Math.max(0, Math.round(squadron.damaged)),
    status: squadron.status,
  }
}
