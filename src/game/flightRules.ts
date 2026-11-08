import type { Point, Role, Squadron } from './types'
import { aircraftRange, aircraftSpeed, aircraftType } from './aircraftTypes'

export const EXECUTION_SECONDS = 22
/** Role defaults remain exported for older callers; new code should use per-formation helpers. */
export const MAX_FLIGHT_DISTANCE: Record<Role, number> = { fighter: aircraftType(undefined, 'fighter').range, recon: aircraftType(undefined, 'recon').range }
export const FLIGHT_SPEED: Record<Role, number> = { fighter: aircraftType(undefined, 'fighter').speed, recon: aircraftType(undefined, 'recon').speed }
export const flightRangeFor = (squadron: Pick<Squadron, 'role' | 'aircraftTypeId' | 'upgrades'>) => aircraftRange(squadron)
export const flightSpeedFor = (squadron: Pick<Squadron, 'role' | 'aircraftTypeId' | 'upgrades'>) => aircraftSpeed(squadron)
export const routeDistance = (route: Point[]) => route.slice(1).reduce((sum, point, i) => sum + Math.hypot(point[0] - route[i][0], point[1] - route[i][1]), 0)
export const missionDistance = (route: Point[], home: Point) => routeDistance(route) + (route.length && Math.hypot(route.at(-1)![0] - home[0], route.at(-1)![1] - home[1]) > .3 ? Math.hypot(route.at(-1)![0] - home[0], route.at(-1)![1] - home[1]) : 0)
export const aircraftAtStrength = (strength: number, maximum: number) => strength <= 0 ? 0 : Math.min(maximum, Math.max(1, Math.ceil(strength * maximum / 100)))
