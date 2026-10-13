import { describe, expect, it } from 'vitest'
import { advanceFrameClock, createFrameClock } from './frameClock'

describe('frame clock', () => {
  it('smoothly interpolates 20 Hz snapshots at 1x and 2x playback', () => {
    for (const rate of [1, 2]) {
      const clock = createFrameClock(0)
      const frameDelta = 1 / 60
      let time = 0
      let observed = 0
      for (let frame = 0; frame < 72; frame++) {
        time += frameDelta
        const snapshot = Math.floor(time * rate * 20) / 20
        observed = advanceFrameClock(clock, snapshot, time, frameDelta)
        expect(observed).toBeLessThanOrEqual(snapshot + 1e-9)
      }
      expect(observed).toBeCloseTo(rate * 1.2, 1)
    }
  })

  it('does not move backward when a target is repeated or rewound', () => {
    const clock = createFrameClock(3, 0)
    expect(advanceFrameClock(clock, 3, .02, .02)).toBe(3)
    expect(advanceFrameClock(clock, 2, .04, .02)).toBe(3)
  })

  it('starts measuring snapshot cadence from the first rendered frame',()=>{
    const clock=createFrameClock(6)
    advanceFrameClock(clock,6,12,.016)
    expect(advanceFrameClock(clock,6.05,12.05,.016)).toBeCloseTo(6.016,3)
  })
})
