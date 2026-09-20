import type { Phase } from './types'

export type CameraPresentationKind = 'command-map' | 'angled-battlefield'

export interface CameraPresentation {
  kind: CameraPresentationKind
  offset: readonly [number, number, number]
  up: readonly [number, number, number]
  worldHeight: number
  followWorldHeight: number
}

export const COMMAND_MAP_PADDING = 2.5

export const COMMAND_MAP_CAMERA: CameraPresentation = {
  kind: 'command-map',
  offset: [0, 30, 0],
  up: [0, 0, -1],
  worldHeight: 12.5,
  followWorldHeight: 12.5,
}

export const ANGLED_BATTLEFIELD_CAMERA: CameraPresentation = {
  kind: 'angled-battlefield',
  offset: [15, 23, 26],
  up: [0, 1, 0],
  worldHeight: 18,
  followWorldHeight: 13.5,
}

export function cameraPresentationForPhase(phase: Phase): CameraPresentation {
  return phase === 'deploy' || phase === 'plan' ? COMMAND_MAP_CAMERA : ANGLED_BATTLEFIELD_CAMERA
}

export function commandMapFitZoom(
  viewport: { width: number; height: number },
  territoryRadius: number,
  minimumZoom: number,
  maximumZoom = 64,
): number {
  const diameterWithPadding = Math.max(1, territoryRadius * 2 + COMMAND_MAP_PADDING)
  const fitZoom = Math.min(viewport.width / diameterWithPadding, viewport.height / diameterWithPadding)
  return Math.min(maximumZoom, Math.max(minimumZoom, fitZoom))
}
