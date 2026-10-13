import { Crosshair, Eye, Shield } from 'lucide-react'
import { CAMPAIGN_ROUND_LIMIT, ENEMY_TARGETING_THRESHOLD } from '../game/campaign'
import type { Asset, MatchState } from '../game/types'
import './CampaignBriefing.css'

function searchSector(startRegionId: string) {
  const opposite: Record<string, string> = {
    'north-west': 'south-east',
    'north-east': 'south-west',
    'south-west': 'north-east',
    'south-east': 'north-west',
  }
  return opposite[startRegionId] ?? 'opposite sector'
}

export function CampaignBriefing({ match, target, homeHealth, enemyHealth }: {
  match: MatchState
  target?: Asset
  homeHealth: number
  enemyHealth?: number
}) {
  const strikeReady = Boolean(target)
  const health = target ? enemyHealth ?? target.health : undefined
  return <details className="campaign-briefing" aria-label="Campaign objectives">
    <summary><Shield/><b>{strikeReady ? 'STRIKE ENEMY BASE' : 'LOCATE ENEMY BASE'}</b><span>HOME {homeHealth}%</span><span className={match.baseExposure>=ENEMY_TARGETING_THRESHOLD?'threat':''}>EXPOSURE {Math.round(match.baseExposure)}%</span></summary>
    <div className="campaign-briefing-detail"><header><span><Shield/></span><div><small>{`DESTROY ENEMY BASE BY END OF ROUND ${CAMPAIGN_ROUND_LIMIT}`}</small><b>CAMPAIGN OBJECTIVES</b></div></header>
    <div className="campaign-objective"><Crosshair/><span><b>{strikeReady ? 'STRIKE CONFIRMED BASE' : 'LOCATE AND STRIKE ENEMY BASE'}</b><small>{strikeReady ? 'Assign a fighter formation to a direct strike ingress.' : `Search ${searchSector(match.world.startRegionId)} with recon and bring the coordinates home.`}</small></span><i className={strikeReady ? 'ready' : ''}>{strikeReady ? 'READY' : 'SEARCH'}</i></div>
    <div className="campaign-threat"><Eye/><span><b>{Math.max(0, Math.round(match.baseExposure))}% BASE EXPOSURE</b><small>{`Recovered enemy recon raises exposure; at ${ENEMY_TARGETING_THRESHOLD}%, fighters may strike next round.`}</small></span><i>{match.baseExposure>=ENEMY_TARGETING_THRESHOLD?'THREAT':'LOW'}</i></div>
    <div className="campaign-health"><span>HOME BASE</span><i><em style={{ width: `${Math.max(0, Math.min(100, homeHealth))}%` }}/></i><b>{homeHealth}%</b></div>
    {strikeReady ? <div className="campaign-health enemy"><span>ENEMY BASE</span><i><em style={{ width: `${Math.max(0, Math.min(100, health ?? 0))}%` }}/></i><b>{health}%</b></div> : null}
    </div>
  </details>
}
