import type { DebriefEventKind } from '../game/debriefMap'

const aircraft = 'M12 2 14 9 22 14 22 17 14 14 14 19 17 21 17 23 12 21 7 23 7 21 10 19 10 14 2 17 2 14 10 9Z'

export function DebriefSymbol({kind}:{kind:DebriefEventKind}) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" className="debrief-symbol" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {kind==='loss'?<><path d={aircraft} fill="currentColor" stroke="none" opacity=".65"/><path d="m4 3 16 18M20 3 4 21" strokeWidth="2.6"/></>
      :kind==='dogfight'?<><path d={aircraft} fill="currentColor" stroke="none" transform="translate(-1 -1) rotate(-35 12 12) scale(.7)"/><path d={aircraft} fill="currentColor" stroke="none" transform="translate(9 9) rotate(145 6 6) scale(.55)"/><path d="m16 3 1 3 3 1M4 17l3 1 1 3"/></>
      :kind==='pursuit'?<><path d={aircraft} fill="currentColor" stroke="none" transform="translate(5 0) scale(.7)"/><path d="m3 14 4 3-4 3m5-6 4 3-4 3"/></>
      :kind==='strike'?<><circle cx="12" cy="12" r="6"/><path d="M12 2v6m0 8v6M2 12h6m8 0h6"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/></>
      :kind==='defense'?<><path d="m12 2 8 4v6c0 5-8 10-8 10S4 17 4 12V6Z"/><path d="m8 14 4-6 4 6m-4-6v10"/></>
      :<><path d="m12 2 10 10-10 10L2 12Z"/><path d="M8 12h8m-4-4v8"/></>}
  </svg>
}

export function DebriefLegend() {
  return <div className="debrief-map-key" aria-label="Round map key">
    {(['dogfight','pursuit','loss','defense','strike','intel'] as const).map(kind=><span key={kind}><DebriefSymbol kind={kind}/>{({dogfight:'Dogfight',pursuit:'Air attack',loss:'Aircraft lost',defense:'Air defense',strike:'Ground strike',intel:'Intel'})[kind]}</span>)}
  </div>
}
