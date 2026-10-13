import { describe, expect, it } from 'vitest'
import { deriveFlightGlyph } from './flightGlyph'

describe('deriveFlightGlyph',()=>{
  it('maps recorded action states without changing their authority',()=>{
    expect(deriveFlightGlyph('INTERCEPT',false)).toEqual({kind:'intercept',selected:false})
    expect(deriveFlightGlyph('DOGFIGHT',false)).toMatchObject({kind:'engaged'})
    expect(deriveFlightGlyph('PURSUIT',false)).toMatchObject({kind:'pursuit'})
    expect(deriveFlightGlyph('RTB',false)).toMatchObject({kind:'returning'})
    expect(deriveFlightGlyph('ENROUTE',false)).toMatchObject({kind:'none'})
  })

  it('keeps selection independent from the recorded action',()=>{
    expect(deriveFlightGlyph('INTERCEPT',true)).toEqual({kind:'intercept',selected:true})
    expect(deriveFlightGlyph('ENROUTE',true)).toEqual({kind:'none',selected:true})
  })
})
