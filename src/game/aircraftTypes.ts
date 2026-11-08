import type { Role, Squadron, UpgradeId } from './types'
import { modifiedStat } from './upgrades'

export interface AircraftTypeDefinition {
  id: string
  name: string
  role: Role
  model: 'f16' | 'atlas'
  maxAircraft: number
  speed: number
  range: number
  sensorRange: number
}

/** Register future airframes here; behavior remains role-driven while platform stats are data-driven. */
export const AIRCRAFT_TYPES: readonly AircraftTypeDefinition[] = [
  { id: 'f16', name: 'F-16 Fighting Falcon', role: 'fighter', model: 'f16', maxAircraft: 4, speed: 40 / 22, range: 40, sensorRange: 4.2 },
  { id: 'recon', name: 'Reconnaissance Flight', role: 'recon', model: 'atlas', maxAircraft: 4, speed: 48 / 22, range: 64, sensorRange: 4.9 },
]

export const DEFAULT_AIRCRAFT_TYPE: Record<Role, string> = { fighter: 'f16', recon: 'recon' }
export const aircraftType = (id: string | undefined, role: Role): AircraftTypeDefinition =>
  AIRCRAFT_TYPES.find(type => type.id === id && type.role === role)
  ?? AIRCRAFT_TYPES.find(type => type.id === DEFAULT_AIRCRAFT_TYPE[role])!

export interface AircraftConfiguration { aircraftTypeId?: string; role: Role; upgrades?: UpgradeId[] }
export const aircraftSpeed = (aircraft: AircraftConfiguration) => modifiedStat(aircraft, 'aircraft.speed', aircraftType(aircraft.aircraftTypeId, aircraft.role).speed)
export const aircraftRange = (aircraft: AircraftConfiguration) => modifiedStat(aircraft, 'aircraft.range', aircraftType(aircraft.aircraftTypeId, aircraft.role).range)
export const aircraftSensorRange = (aircraft: AircraftConfiguration) => modifiedStat(aircraft, 'aircraft.sensorRange', aircraftType(aircraft.aircraftTypeId, aircraft.role).sensorRange)

export function normalizeAircraftType<T extends AircraftConfiguration>(aircraft: T): T & { aircraftTypeId: string; upgrades: UpgradeId[] } {
  const definition = aircraftType(aircraft.aircraftTypeId, aircraft.role)
  return { ...aircraft, aircraftTypeId: definition.id, upgrades: aircraft.upgrades ?? [] }
}
