import { memo, useEffect, useMemo } from 'react'
import * as THREE from 'three'
import type { TerrainMap, WorldBounds } from '../game/types'

const palette = {
  uncharted: new THREE.Color('#424b40'),
  meadow: new THREE.Color('#64754b'),
  woodland: new THREE.Color('#344c38'),
  dryGrass: new THREE.Color('#85815a'),
  gravel: new THREE.Color('#a39372'),
  rock: new THREE.Color('#5a5d58'),
  summit: new THREE.Color('#c4bdb0'),
  beach: new THREE.Color('#b4a17a'),
  surf: new THREE.Color('#8eada1'),
  shallows: new THREE.Color('#437f82'),
  ocean: new THREE.Color('#23485b'),
}

const mix = THREE.MathUtils.lerp
const smooth = THREE.MathUtils.smoothstep

function hash(x: number, z: number) {
  const h = Math.imul(x, 0x1f123bb5) ^ Math.imul(z, 0x5f356495)
  const n = Math.imul(h ^ (h >>> 16), 0x45d9f3b)
  return ((n ^ (n >>> 16)) >>> 0) / 0x100000000
}

function noise(x: number, z: number) {
  const ix = Math.floor(x)
  const iz = Math.floor(z)
  const u = smooth(x - ix, 0, 1)
  const v = smooth(z - iz, 0, 1)
  return mix(mix(hash(ix, iz), hash(ix + 1, iz), u),
    mix(hash(ix, iz + 1), hash(ix + 1, iz + 1), u), v)
}

// Keep all samples on one world-space lattice. Uncharted space needs only
// a coarse apron, and newly mapped regions join the same surface seamlessly.
function sampleAxis(min: number, max: number, first: number, last: number) {
  const step = .125
  const start = Math.ceil(Math.max(min + 1e-5, first - 1.1) / step)
  const end = Math.floor(Math.min(max - 1e-5, last + 1.1) / step)
  const coordinates = [min]
  for (let i = start; i <= end; i++) coordinates.push(i * step)
  coordinates.push(max)
  return coordinates
}

function createRelief(bounds: WorldBounds, terrain?: TerrainMap) {
  const cellSize = terrain?.cellSize ?? .75
  const originX = terrain?.originX ?? 0
  const originZ = terrain?.originZ ?? 0
  const width = terrain?.width ?? 1
  const height = terrain?.height ?? 1
  const cells = new Uint8Array(width * height)
  for (const cell of terrain?.cells ?? []) {
    cells[cell.index] = cell.kind === 'land' ? 1 : cell.kind === 'water' ? 2 : 3
  }
  const xs = terrain ? sampleAxis(bounds.minX, bounds.maxX, originX, originX + (width - 1) * cellSize) : [bounds.minX, bounds.maxX]
  const zs = terrain ? sampleAxis(bounds.minZ, bounds.maxZ, originZ, originZ + (height - 1) * cellSize) : [bounds.minZ, bounds.maxZ]
  const vertexCount = xs.length * zs.length
  const positions = new Float32Array(vertexCount * 3)
  const colors = new Float32Array(vertexCount * 3)
  const surfaces = new Float32Array(vertexCount * 2)
  const color = new THREE.Color()
  const upland = new THREE.Color()

  for (let row = 0; row < zs.length; row++) {
    for (let column = 0; column < xs.length; column++) {
      const x = xs[column]
      const z = zs[row]
      const index = row * xs.length + column
      // Bend the interpolation locally to break up straight grid edges without
      // moving the center of a cell across the edge of its terrain category.
      const gx = (x + (noise(x * 1.55 + 41, z * 1.55) - .5) * .27 - originX) / cellSize
      const gz = (z + (noise(x * 1.55, z * 1.55 + 59) - .5) * .27 - originZ) / cellSize
      const ix = Math.floor(gx)
      const iz = Math.floor(gz)
      const u = smooth(gx - ix, 0, 1)
      const v = smooth(gz - iz, 0, 1)
      let land = 0
      let water = 0
      let mountain = 0
      for (let dz = 0; dz < 2; dz++) {
        for (let dx = 0; dx < 2; dx++) {
          const cx = ix + dx
          const cz = iz + dz
          if (cx < 0 || cz < 0 || cx >= width || cz >= height) continue
          const weight = (dx ? u : 1 - u) * (dz ? v : 1 - v)
          switch (cells[cz * width + cx]) {
            case 1: land += weight; break
            case 2: water += weight; break
            case 3: mountain += weight; break
          }
        }
      }
      const known = smooth(land + water + mountain, .06, .86)
      const coast = (water - land - mountain) / Math.max(.001, land + water + mountain)
      const sea = smooth(coast, -.035, .065) * known
      const foliage = noise(x * .44, z * .44) * .74 + noise(x * 1.9, z * 1.9) * .26
      const ridge = 1 - Math.abs(noise(x * 1.02 + 7, z * 1.02 - 8) * 2 - 1)
      const cuts = noise(x * 3.7 + z * .55, z * 2.2 - x * .48)
      const massif = smooth(mountain, .08, .94)
      const peak = massif * (.09 + .29 * ridge ** 3 + .20 * cuts ** 2)
      const ravine = massif * (1 - ridge) * (1 - cuts) * .22
      const elevation = Math.min(.54, peak - ravine) - .075 * sea

      color.copy(palette.meadow).lerp(palette.woodland, smooth(foliage, .35, .78))
        .lerp(palette.dryGrass, .4 * (1 - smooth(foliage, .18, .43)))
      const beach = smooth(coast, -.67, -.12) * (1 - smooth(coast, -.05, .1))
      color.lerp(palette.beach, beach * .9)
      if (mountain > .08) {
        const rock = smooth(peak + (cuts - .5) * .12, .12, .31)
        upland.copy(palette.gravel).lerp(palette.rock, rock)
          .lerp(palette.summit, smooth(peak + (cuts - .5) * .09, .25, .48) * .88)
        color.lerp(upland, massif)
      }
      if (sea > 0) {
        const depth = smooth(coast, .04, .95)
        upland.copy(palette.shallows).lerp(palette.ocean, depth)
          .lerp(palette.surf, (1 - smooth(coast, .045, .27)) * .86)
        color.lerp(upland, smooth(coast, -.035, .065))
      }
      color.lerp(palette.uncharted, 1 - known)
      positions.set([x, elevation, z], index * 3)
      colors.set([color.r, color.g, color.b], index * 3)
      surfaces.set([sea, massif], index * 2)
    }
  }

  const indices = vertexCount > 65535
    ? new Uint32Array((xs.length - 1) * (zs.length - 1) * 6)
    : new Uint16Array((xs.length - 1) * (zs.length - 1) * 6)
  let face = 0
  for (let row = 0; row < zs.length - 1; row++) {
    for (let column = 0; column < xs.length - 1; column++) {
      const a = row * xs.length + column
      const b = a + xs.length
      indices.set([a, b, a + 1, a + 1, b, b + 1], face)
      face += 6
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geometry.setAttribute('terrainSurface', new THREE.BufferAttribute(surfaces, 2))
  geometry.setIndex(new THREE.BufferAttribute(indices, 1))
  geometry.computeVertexNormals()
  return geometry
}

// Fine grain and wavelets are evaluated in world space so they stay put when
// the camera moves or mapping expands. Geometry supplies the large landforms.
const shadeRelief: THREE.MeshStandardMaterial['onBeforeCompile'] = shader => {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>
      attribute vec2 terrainSurface;
      varying vec3 terrainPosition;
      varying vec2 terrainMaterial;`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>
      terrainPosition = position;
      terrainMaterial = terrainSurface;`)
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>
      varying vec3 terrainPosition;
      varying vec2 terrainMaterial;
      float terrainGrain(vec2 point) {
        return fract(sin(dot(point, vec2(127.1, 311.7))) * 43758.5453);
      }`)
    .replace('#include <color_fragment>', `#include <color_fragment>
      vec2 ground = terrainPosition.xz;
      float grain = terrainGrain(floor(ground * 65.0)) - 0.5;
      float wave = sin(dot(ground, vec2(7.0, 12.0)) + 1.6 * sin(ground.x * 4.0 - ground.y * 2.0));
      float ripples = smoothstep(0.36, 0.95, wave) * (0.5 + 0.5 * sin(ground.x * 1.9 + ground.y * 1.3));
      float rockBands = sin(terrainPosition.y * 92.0 + dot(ground, vec2(2.1, 1.7)));
      diffuseColor.rgb *= 1.0 + grain * mix(0.16, 0.065, terrainMaterial.x)
        + 0.06 * rockBands * terrainMaterial.y + 0.075 * ripples * terrainMaterial.x;`)
}

export function useTerrainRelief(bounds: WorldBounds, terrain?: TerrainMap) {
  const { minX, maxX, minZ, maxZ } = bounds
  const geometry = useMemo(() => createRelief({ minX, maxX, minZ, maxZ }, terrain), [minX, maxX, minZ, maxZ, terrain])
  useEffect(() => () => geometry.dispose(), [geometry])
  return geometry
}

export const TerrainRelief = memo(function TerrainRelief({ geometry }: { geometry: THREE.BufferGeometry }) {
  return <mesh geometry={geometry} receiveShadow>
    <meshStandardMaterial vertexColors roughness={1} onBeforeCompile={shadeRelief}/>
  </mesh>
})
