import { describe, expect, it } from 'vitest'
import { groupDebriefPins } from './DebriefMapOverlay'

describe('Debrief map pin layout', () => {
  it('merges nearby tap targets and separates them as the map zooms in', () => {
    const pins = [{ id: 'a', x: 25, y: 25 }, { id: 'b', x: 60, y: 53 }, { id: 'c', x: 125, y: 65 }]
    expect(groupDebriefPins(pins)).toEqual([['a', 'b'], ['c']])
    expect(groupDebriefPins(pins.map(pin => ({ ...pin, x: pin.x * 2, y: pin.y * 2 })))).toEqual([['a'], ['b'], ['c']])
  })

  it('anchors a cluster on the selected report so it remains visible', () => {
    const pins = [{ id: 'a', x: 25, y: 25 }, { id: 'b', x: 60, y: 25 }, { id: 'c', x: 95, y: 25 }]
    expect(groupDebriefPins(pins, 'b')).toEqual([['b', 'a', 'c']])
  })
})
