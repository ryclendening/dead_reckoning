import type { Point } from './types'

const pointDistance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1])

export function maxEscortRoute(launch: Point, protectedRoute: Point[], recovery: Point, maxDistance: number): Point[] {
  if (protectedRoute.length < 1 || pointDistance(launch, recovery) > maxDistance) return [launch]
  const route: Point[] = [[...launch]]
  let traveled = 0, current = [...launch] as Point
  for (const destination of protectedRoute) {
    const length = pointDistance(current, destination)
    if (length < .001) continue
    const fits = (ratio: number) => traveled + length * ratio + pointDistance([current[0] + (destination[0] - current[0]) * ratio, current[1] + (destination[1] - current[1]) * ratio], recovery) <= maxDistance + .001
    if (fits(1)) { route.push([...destination] as Point); traveled += length; current = [...destination] as Point; continue }
    let low = 0, high = 1
    for (let index = 0; index < 24; index++) { const mid = (low + high) / 2; if (fits(mid)) low = mid; else high = mid }
    if (low > .001) { current = [current[0] + (destination[0] - current[0]) * low, current[1] + (destination[1] - current[1]) * low]; route.push(current) }
    break
  }
  return route
}
