import { describe, expect, it } from 'vitest'
import { deriveFlightGlyph } from './flightGlyph'

describe('deriveFlightGlyph',()=>{
  it('maps recorded action states without changing their authority',()=>{
    expect(deriveFlightGlyph('INTERCEPT',false,0)).toMatchObject({kind:'intercept',selected:false,radarLinkOpacity:0})
    expect(deriveFlightGlyph('DOGFIGHT',false,0)).toMatchObject({kind:'engaged'})
    expect(deriveFlightGlyph('PURSUIT',false,0)).toMatchObject({kind:'pursuit'})
    expect(deriveFlightGlyph('RTB',false,0)).toMatchObject({kind:'returning'})
    expect(deriveFlightGlyph('ENROUTE',false,0)).toMatchObject({kind:'none'})
  })

  it('keeps selection and radar-link receipt as independent modifiers',()=>{
    expect(deriveFlightGlyph('INTERCEPT',true,.6)).toEqual({kind:'intercept',selected:true,radarLinkOpacity:.6})
    expect(deriveFlightGlyph('ENROUTE',true,2)).toEqual({kind:'none',selected:true,radarLinkOpacity:1})
  })
})
