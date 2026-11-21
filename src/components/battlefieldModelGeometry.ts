import { BufferAttribute, Color, type BufferGeometry } from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

export function paintGeometry(source: BufferGeometry, top: string, side = top): BufferGeometry {
  const geometry = source.index ? source.toNonIndexed() : source
  if (geometry !== source) source.dispose()

  const count = geometry.getAttribute('position').count
  const colors = new Float32Array(count * 3)
  const topColor = new Color(top)
  const sideColor = new Color(side)
  for (let i = 0; i < count; i++) topColor.toArray(colors, i * 3)
  for (const group of geometry.groups) {
    if (group.materialIndex !== 1) continue
    for (let i = group.start; i < group.start + group.count; i++) sideColor.toArray(colors, i * 3)
  }
  geometry.deleteAttribute('uv')
  geometry.setAttribute('color', new BufferAttribute(colors, 3))
  return geometry
}

export function joinModel(parts: BufferGeometry[]): BufferGeometry {
  const geometry = mergeGeometries(parts)!
  for (const part of parts) part.dispose()
  return geometry
}
