import type { Point, Role } from './types'

export const EXECUTION_SECONDS = 22
export const MAX_FLIGHT_DISTANCE: Record<Role, number> = { fighter: 40, recon: 64 }
export const FLIGHT_SPEED: Record<Role, number> = { fighter: 40 / EXECUTION_SECONDS, recon: 48 / EXECUTION_SECONDS }
export const routeDistance = (route: Point[]) => route.slice(1).reduce((sum, point, i) => sum + Math.hypot(point[0] - route[i][0], point[1] - route[i][1]), 0)
export const missionDistance = (route: Point[], home: Point) => routeDistance(route) + (route.length && Math.hypot(route.at(-1)![0] - home[0], route.at(-1)![1] - home[1]) > .3 ? Math.hypot(route.at(-1)![0] - home[0], route.at(-1)![1] - home[1]) : 0)
export const aircraftAtStrength = (strength: number, maximum: number) => strength <= 0 ? 0 : Math.min(maximum, Math.max(1, Math.ceil(strength * maximum / 100)))
