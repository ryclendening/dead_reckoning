import { describe, expect, it } from 'vitest'
import {
  ANGLED_BATTLEFIELD_CAMERA,
  cameraPresentationForPhase,
  COMMAND_MAP_CAMERA,
  commandMapFitZoom,
} from './cameraPresentation'

describe('battlefield camera presentation', () => {
  it('uses a true top-down command map only for Deploy and Plan', () => {
    expect(cameraPresentationForPhase('deploy')).toBe(COMMAND_MAP_CAMERA)
    expect(cameraPresentationForPhase('plan')).toBe(COMMAND_MAP_CAMERA)
    expect(cameraPresentationForPhase('execute')).toBe(ANGLED_BATTLEFIELD_CAMERA)
    expect(cameraPresentationForPhase('debrief')).toBe(ANGLED_BATTLEFIELD_CAMERA)
    expect(cameraPresentationForPhase('adapt')).toBe(ANGLED_BATTLEFIELD_CAMERA)
  })

  it('keeps the command camera directly above its target with an independent screen-up axis', () => {
    expect(COMMAND_MAP_CAMERA.offset[0]).toBe(0)
    expect(COMMAND_MAP_CAMERA.offset[2]).toBe(0)
    expect(COMMAND_MAP_CAMERA.offset[1]).toBeGreaterThan(0)
    expect(COMMAND_MAP_CAMERA.up[1]).toBe(0)
    expect(Math.hypot(COMMAND_MAP_CAMERA.up[0], COMMAND_MAP_CAMERA.up[2])).toBeGreaterThan(0)
  })

  it('fits the full starting territory on both portrait and landscape viewports', () => {
    const portrait = { width: 390, height: 844 }
    const landscape = { width: 844, height: 390 }
    const portraitZoom = commandMapFitZoom(portrait, 4.5, 1)
    const landscapeZoom = commandMapFitZoom(landscape, 4.5, 1)
    expect(portrait.width / portraitZoom).toBeGreaterThanOrEqual(11.5)
    expect(landscape.height / landscapeZoom).toBeGreaterThanOrEqual(11.5)
    expect(portraitZoom).toBeCloseTo(landscapeZoom)
  })

  it('honors camera zoom limits', () => {
    expect(commandMapFitZoom({ width: 100, height: 100 }, 4.5, 12)).toBe(12)
    expect(commandMapFitZoom({ width: 2000, height: 2000 }, 4.5, 1)).toBe(64)
  })
})
