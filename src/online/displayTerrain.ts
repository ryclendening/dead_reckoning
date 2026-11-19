import type { TerrainCell, TerrainMap } from '../game/types'

// Two seats share the same relief. Keep it separate from the surveyed grid
// used by order and placement validation, and compact enough for polling.
export function packDisplayTerrain(terrain: TerrainMap | undefined): string | undefined {
  if (!terrain) return undefined
  const { originX, originZ, width, height, cellSize } = terrain
  const surface = Array<string>(width * height).fill('.')
  for (const cell of terrain.cells) {
    surface[cell.index] = cell.kind === 'mountain' ? 'm' : cell.kind === 'water' ? 'w' : 'l'
  }
  return JSON.stringify([originX, originZ, width, height, cellSize, surface.join('')])
}

export function unpackDisplayTerrain(packed: string | undefined): TerrainMap | undefined {
  if (!packed) return undefined
  const [originX, originZ, width, height, cellSize, surface] = JSON.parse(packed) as [
    number, number, number, number, number, string,
  ]
  const cells: TerrainCell[] = []
  for (let index = 0; index < surface.length; index++) {
    const code = surface[index]
    if (code === '.') continue
    cells.push({
      index,
      x: originX + (index % width) * cellSize,
      z: originZ + Math.floor(index / width) * cellSize,
      kind: code === 'm' ? 'mountain' : code === 'w' ? 'water' : 'land',
    })
  }
  return { version: 1, originX, originZ, width, height, cellSize, cells }
}
