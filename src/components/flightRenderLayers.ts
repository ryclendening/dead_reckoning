import { AlwaysStencilFunc, NotEqualStencilFunc, ReplaceStencilOp, type MaterialParameters } from 'three'

const aircraftStencilBit = 1

// Opaque airframes mark their visible pixels before the transparent routes draw.
export const aircraftStencil = {
  stencilWrite: true,
  stencilWriteMask: aircraftStencilBit,
  stencilFunc: AlwaysStencilFunc,
  stencilRef: aircraftStencilBit,
  stencilZPass: ReplaceStencilOp,
} satisfies MaterialParameters

// Routes can cross terrain without painting over any visible airframe.
export const flightLineLayer = {
  depthTest: false,
  depthWrite: false,
  stencilWrite: true,
  stencilWriteMask: 0,
  stencilFunc: NotEqualStencilFunc,
  stencilFuncMask: aircraftStencilBit,
  stencilRef: aircraftStencilBit,
} satisfies MaterialParameters
