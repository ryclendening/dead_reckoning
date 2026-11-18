import { beginNextRound, openAdaptPhase } from '../economy'
import type { MatchState } from '../types'

interface Request {
  requestId: number
  action: 'adapt' | 'plan'
  match: MatchState
}

interface Response {
  requestId: number
  round: number
  phase: MatchState['phase']
  cpu?: MatchState['cpu']
  enemyAssets: MatchState['enemyAssets']
  enemyBaseHealth: MatchState['enemyBaseHealth']
  onlineOutcome?: MatchState['onlineOutcome']
  error?: string
}

const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<Request>) => void) | null
  postMessage: (message: Response) => void
}

scope.onmessage = ({ data }) => {
  try {
    const updated = data.action === 'adapt' ? openAdaptPhase(data.match) : beginNextRound(data.match)
    const expectedRound = data.action === 'adapt' ? data.match.round : data.match.round + 1
    const expectedPhase = data.action === 'adapt' ? 'adapt' : 'plan'
    if (updated.round !== expectedRound || updated.phase !== expectedPhase) {
      throw new Error('The next round is unavailable.')
    }
    scope.postMessage({
      requestId: data.requestId,
      round: updated.round,
      phase: updated.phase,
      cpu: updated.cpu,
      enemyAssets: updated.enemyAssets,
      enemyBaseHealth: updated.enemyBaseHealth,
      onlineOutcome: updated.onlineOutcome,
    })
  } catch (error) {
    scope.postMessage({
      requestId: data.requestId,
      round: data.action === 'adapt' ? data.match.round : data.match.round + 1,
      phase: data.action === 'adapt' ? 'adapt' : 'plan',
      enemyAssets: data.match.enemyAssets,
      enemyBaseHealth: data.match.enemyBaseHealth,
      error: error instanceof Error ? error.message : 'CPU planning failed.',
    })
  }
}
