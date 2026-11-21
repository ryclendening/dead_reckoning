import { BoxGeometry, CylinderGeometry, MeshStandardMaterial, type BufferGeometry } from 'three'
import { joinModel, paintGeometry } from './battlefieldModelGeometry'

const concrete = '#8b8977'
const asphalt = '#414947'
const metal = '#556564'
const pale = '#d7d5b7'
const wheel = '#2c3534'

function box(width: number, height: number, depth: number, x: number, y: number, z: number, color: string) {
  return paintGeometry(new BoxGeometry(width, height, depth).translate(x, y, z), color)
}

function cylinder(top: number, bottom: number, height: number, x: number, y: number, z: number, color: string, tilt = 0) {
  return paintGeometry(new CylinderGeometry(top, bottom, height, 8).rotateZ(tilt).translate(x, y, z), color)
}

function mainAirfield() {
  return joinModel([
    box(2.22, .061, .68, 0, .02, 0, concrete),
    box(2.14, .032, .54, 0, .059, 0, asphalt),
    ...[-.9, .9].flatMap(x => [-.135, .135].map(z => box(.16, .014, .057, x, .081, z, pale))),
    ...[-.51, 0, .51].map(x => box(.24, .012, .029, x, .079, 0, pale)),
    box(.86, .044, .43, -.21, .029, -.47, concrete),
    box(.49, .25, .35, -.33, .146, -.49, metal),
    box(.55, .06, .41, -.33, .289, -.49, '#77948c'),
    box(.135, .38, .135, .13, .212, -.5, '#737f73'),
    box(.185, .076, .177, .13, .422, -.5, '#426261'),
  ])
}

function shortAirfield(length: number, width: number) {
  return joinModel([
    box(length, .058, width, 0, .024, 0, asphalt),
    ...[-1, 0, 1].map(i => box(.2, .014, .04, i * length * .32, .056, 0, pale)),
    box(.32, .21, .24, -.18, .12, -width * .76, metal),
  ])
}

const groundMaterial = new MeshStandardMaterial({ vertexColors: true, roughness: .9 })
const hostileGroundMaterial = new MeshStandardMaterial({ vertexColors: true, color: '#ead0b7', roughness: .9 })
const damagedGroundMaterial = new MeshStandardMaterial({ vertexColors: true, color: '#71665e', roughness: 1 })

export function groundSiteMaterial(hostile: boolean, operational: boolean) {
  return operational ? hostile ? hostileGroundMaterial : groundMaterial : damagedGroundMaterial
}

export const runwayModels = { base: mainAirfield(), fob: shortAirfield(1.35, .4), decoy: shortAirfield(2, .5) }

export const radarBase = joinModel([
  box(.66, .09, .62, 0, .05, 0, concrete),
  box(.44, .25, .36, 0, .187, 0, metal),
  cylinder(.086, .12, .29, 0, .4, 0, metal),
  box(.25, .05, .17, 0, .22, .203, '#9fae94'),
])
export const radarPanel = joinModel([
  box(.73, .36, .081, 0, 0, 0, metal),
  box(.65, .291, .031, 0, 0, .055, '#2d514d'),
  ...[-.09, 0, .09].map(y => box(.55, .037, .018, 0, y, .073, '#91b4a2')),
  box(.036, .29, .024, 0, 0, .075, pale),
]).rotateX(-.46)

const samModels = new Map<string, BufferGeometry>()
export function samModel(capacity: number, remaining: number) {
  const key = `${capacity}:${remaining}`
  const cached = samModels.get(key)
  if (cached) return cached

  const spacing = .56 / Math.max(3, capacity)
  const mount = [
    box(.78, .065, .7, 0, .035, 0, concrete),
    box(.64, .121, .48, 0, .126, 0, wheel),
    box(.54, .155, .43, 0, .247, -.035, metal),
    box(.58, .065, .15, 0, .297, .17, '#7d8876'),
  ]
  for (let index = 0; index < capacity; index++) {
    const x = (index - (capacity - 1) / 2) * spacing
    mount.push(cylinder(.063, .069, .28, x, .369, -.006, metal, -.32))
    if (index < remaining) mount.push(cylinder(.035, .051, .27, x + .08, .597, -.006, pale, -.32))
  }
  const result = joinModel(mount)
  samModels.set(key, result)
  return result
}
