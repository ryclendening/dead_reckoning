export type FlightGlyphKind='none'|'intercept'|'engaged'|'pursuit'|'returning'

export interface FlightGlyphState {
  kind:FlightGlyphKind
  selected:boolean
  radarLinkOpacity:number
}

/** Projects recorded replay state into a compact friendly-flight glyph. */
export function deriveFlightGlyph(action:string,selected:boolean,radarLinkOpacity:number):FlightGlyphState{
  const kind:FlightGlyphKind=action==='DOGFIGHT'?'engaged':action==='INTERCEPT'?'intercept':action==='PURSUIT'?'pursuit':action==='RTB'||action==='BREAKING CONTACT'?'returning':'none'
  return {kind,selected,radarLinkOpacity:Math.max(0,Math.min(1,radarLinkOpacity))}
}
