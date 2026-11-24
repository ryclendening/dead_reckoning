import { ExtrudeGeometry, MeshBasicMaterial, MeshStandardMaterial, Shape, ShapeGeometry } from 'three'
import type { Role } from '../game/types'
import { joinModel, paintGeometry } from './battlefieldModelGeometry'
import { aircraftStencil } from './flightRenderLayers'

type Point2 = [number, number]
type Paint = 'body' | 'wing' | 'glass' | 'engine' | 'marking'
type Part = { outline: Point2[]; height: number; thickness: number; paint: Paint; inset?: boolean }
type Tail = { x: number; outline: Point2[] }
type Airframe = { parts: Part[]; tails: Tail[] }
type AirframeId = 'f16' | 'u2' | 'b52' | 'mig23' | 'mig25' | 'tu95'

const friendlyAirframes: Record<Role, AirframeId> = { fighter: 'f16', recon: 'u2', bomber: 'b52' }
const hostileAirframes: Record<Role, AirframeId> = { fighter: 'mig23', recon: 'mig25', bomber: 'tu95' }

// These planforms are designed for the battlefield's angled camera. Flight forward is local +Z.
const mirroredOutline = (edge: Point2[]): Point2[] => [
  ...edge,
  ...edge.slice().reverse().filter(([x]) => x !== 0).map(([x, z]): Point2 => [-x, z]),
]
const center = (edge: Point2[], paint: Paint, height: number, thickness: number, inset = false): Part =>
  ({ outline: mirroredOutline(edge), paint, height, thickness, inset })
const pair = (outline: Point2[], paint: Paint, height: number, thickness: number, inset = false): Part[] => [
  { outline, paint, height, thickness, inset },
  { outline: outline.map(([x, z]) => [-x, z]), paint, height, thickness, inset },
]
const tail = (x: number, z: number, height: number, length: number): Tail => ({
  x,
  outline: [[z, .06], [z - length * .56, height], [z - length * .88, height], [z - length, .05]],
})

const airframes: Record<AirframeId, Airframe> = {
  f16: {
    parts: [
      center([[0, .82], [.11, .52], [.2, .22], [.16, -.45], [.1, -.71]], 'body', -.07, .155),
      ...pair([[.11, .31], [.52, -.13], [.55, -.34], [.17, -.31], [.13, -.36]], 'wing', -.042, .048),
      ...pair([[.11, -.4], [.3, -.58], [.31, -.73], [.1, -.68]], 'wing', -.016, .047),
      center([[0, .58], [.075, .44], [.094, .29], [.065, .2], [0, .16]], 'glass', .082, .075, true),
      ...pair([[.4, -.18], [.47, -.24], [.49, -.29], [.4, -.28]], 'marking', .007, .006, true),
    ],
    tails: [tail(0, -.3, .29, .43)],
  },
  u2: {
    parts: [
      center([[0, .72], [.089, .56], [.13, .17], [.09, -.42], [.037, -.67]], 'body', -.057, .123),
      ...pair([[.085, .18], [.93, .12], [1.04, .07], [1.02, -.035], [.11, -.11]], 'wing', -.039, .045),
      ...pair([[.04, -.4], [.28, -.51], [.26, -.61], [.023, -.59]], 'wing', .005, .04),
      center([[0, .54], [.057, .45], [.064, .35], [0, .27]], 'glass', .063, .049, true),
      ...pair([[.78, .126], [.86, .121], [.86, -.043], [.78, -.051]], 'marking', .008, .006, true),
    ],
    tails: [tail(0, -.35, .22, .32)],
  },
  b52: {
    parts: [
      center([[0, 1.02], [.127, .87], [.165, .67], [.156, -.45], [.082, -.92], [0, -1]], 'body', -.082, .18),
      ...pair([[.12, .35], [1.13, -.38], [1.14, -.48], [.17, -.2]], 'wing', -.043, .072),
      ...pair([[.068, -.55], [.41, -.82], [.39, -.91], [.045, -.79]], 'wing', .027, .045),
      ...pair([[.34, .23], [.47, .175], [.47, -.06], [.35, -.055]], 'engine', -.115, .152),
      ...pair([[.65, -.01], [.79, -.065], [.79, -.27], [.66, -.265]], 'engine', -.115, .151),
      center([[0, .85], [.081, .76], [.09, .68], [0, .69]], 'glass', .094, .048, true),
      ...pair([[.88, -.23], [.957, -.28], [.953, -.406], [.88, -.38]], 'marking', .031, .007, true),
    ],
    tails: [tail(0, -.44, .37, .52)],
  },
  mig23: {
    parts: [
      center([[0, .85], [.098, .57], [.19, .33], [.178, -.39], [.122, -.72]], 'body', -.072, .165),
      ...pair([[.13, .29], [.29, .16], [.61, -.36], [.61, -.44], [.15, -.27]], 'wing', -.047, .049),
      ...pair([[.12, -.39], [.31, -.61], [.28, -.76], [.08, -.67]], 'wing', -.021, .051),
      ...pair([[.09, .38], [.192, .37], [.21, -.08], [.14, -.2]], 'engine', -.045, .109),
      center([[0, .56], [.06, .47], [.071, .31], [0, .23]], 'glass', .09, .06, true),
      ...pair([[.43, -.18], [.49, -.25], [.47, -.342], [.41, -.315]], 'marking', .004, .006, true),
    ],
    tails: [tail(0, -.17, .35, .59)],
  },
  mig25: {
    parts: [
      center([[0, .9], [.125, .63], [.143, .35], [.235, .21], [.245, -.62], [.184, -.79]], 'body', -.075, .169),
      ...pair([[.185, .34], [.69, -.01], [.675, -.22], [.23, -.28]], 'wing', -.048, .069),
      ...pair([[.162, -.46], [.454, -.6], [.426, -.77], [.16, -.74]], 'wing', -.034, .069),
      ...pair([[.085, .3], [.233, .32], [.253, -.71], [.105, -.768]], 'engine', -.04, .14),
      center([[0, .644], [.069, .545], [.069, .429], [0, .34]], 'glass', .092, .057, true),
      ...pair([[.49, .11], [.555, .065], [.55, -.235], [.49, -.243]], 'marking', .023, .006, true),
    ],
    tails: [tail(-.18, -.31, .29, .48), tail(.18, -.31, .29, .48)],
  },
  tu95: {
    parts: [
      center([[0, .98], [.106, .83], [.142, .66], [.13, -.52], [.056, -.94], [0, -1]], 'body', -.071, .148),
      ...pair([[.12, .31], [1.05, -.34], [1.16, -.46], [1.14, -.53], [.12, -.21]], 'wing', -.043, .065),
      ...pair([[.063, -.56], [.406, -.79], [.39, -.89], [.051, -.83]], 'wing', .009, .054),
      ...pair([[.29, .36], [.413, .32], [.42, -.1], [.31, -.14]], 'engine', -.057, .14),
      ...pair([[.587, .183], [.7, .144], [.721, -.31], [.607, -.328]], 'engine', -.057, .14),
      ...pair([[.186, .337], [.514, .337], [.514, .408], [.186, .408]], 'marking', .029, .03),
      ...pair([[.494, .159], [.826, .159], [.826, .231], [.494, .231]], 'marking', .025, .031),
      center([[0, .856], [.079, .768], [.08, .676], [0, .68]], 'glass', .075, .046, true),
    ],
    tails: [tail(0, -.46, .32, .51)],
  },
}

const palettes: Record<'friendly' | 'hostile', Record<Paint, string>> = {
  friendly: { body: '#849a9d', wing: '#647f83', glass: '#1c333e', engine: '#475658', marking: '#64e0df' },
  hostile: { body: '#ada18e', wing: '#95846b', glass: '#342e31', engine: '#655a56', marking: '#f07d5d' },
}
const shadedMaterial = new MeshStandardMaterial({ vertexColors: true, roughness: .85, ...aircraftStencil })
const silhouetteMaterials = {
  friendly: new MeshBasicMaterial({ color: '#8ae5e4', toneMapped: false, ...aircraftStencil }),
  hostile: new MeshBasicMaterial({ color: '#fb9a7c', toneMapped: false, ...aircraftStencil }),
  reinforcement: new MeshBasicMaterial({ color: '#f1c65b', toneMapped: false, ...aircraftStencil }),
}

function shape(points: Point2[], vertical = false) {
  const result = new Shape()
  points.forEach(([x, z], i) => {
    const y = vertical ? z : -z
    if (i === 0) result.moveTo(x, y)
    else result.lineTo(x, y)
  })
  result.closePath()
  return result
}

function makeAircraft(id: AirframeId, side: 'friendly' | 'hostile') {
  const frame = airframes[id]
  const palette = palettes[side]
  const model = frame.parts.map(({ outline, height, thickness, paint }) => {
    const geometry = new ExtrudeGeometry(shape(outline), { depth: thickness, bevelEnabled: false })
    geometry.rotateX(-Math.PI / 2).translate(0, height, 0)
    return paintGeometry(geometry, palette[paint], paint === 'marking' ? palette.marking : palette.engine)
  })
  for (const { x, outline } of frame.tails) {
    const geometry = new ExtrudeGeometry(shape(outline, true), { depth: .05, bevelEnabled: false })
    geometry.rotateY(-Math.PI / 2).translate(x + .025, 0, 0)
    model.push(paintGeometry(geometry, palette.body, palette.wing))
  }
  const silhouette = frame.parts.filter(part => !part.inset).map(({ outline }) =>
    paintGeometry(new ShapeGeometry(shape(outline)).rotateX(-Math.PI / 2), '#ffffff'))
  const size = id === 'f16' ? .455 : id === 'b52' || id === 'tu95' ? .39 : .42
  return {
    model: joinModel(model).scale(size, size, size),
    silhouette: joinModel(silhouette).scale(size, size, size),
    material: shadedMaterial,
    silhouetteMaterial: silhouetteMaterials[side],
  }
}

const models = {
  f16: makeAircraft('f16', 'friendly'),
  u2: makeAircraft('u2', 'friendly'),
  b52: makeAircraft('b52', 'friendly'),
  mig23: makeAircraft('mig23', 'hostile'),
  mig25: makeAircraft('mig25', 'hostile'),
  tu95: makeAircraft('tu95', 'hostile'),
}

export function aircraftModel(role: Role, hostile: boolean) {
  return models[(hostile ? hostileAirframes : friendlyAirframes)[role]]
}

export const reinforcementSilhouetteMaterial = silhouetteMaterials.reinforcement

// CSS pixels per map unit, with hysteresis so small camera changes do not swap meshes repeatedly.
export function aircraftSilhouetteAtScale(pixelsPerUnit: number, silhouette: boolean): boolean {
  return pixelsPerUnit < (silhouette ? 23 : 20)
}
