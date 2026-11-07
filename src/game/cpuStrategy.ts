import type { CpuDifficulty } from './types'
import { ENEMY_TARGETING_THRESHOLD } from './campaign'

/** The CPU commits to a base strike only after recovered recon raises pressure to this level. */
export const CPU_STRIKE_THRESHOLDS: Record<CpuDifficulty, number> = {
  easy: 80,
  medium: ENEMY_TARGETING_THRESHOLD,
  hard: 40,
}

export function shouldCpuStrikeBase(difficulty: CpuDifficulty | undefined, recoveredBaseExposure: number): boolean {
  return recoveredBaseExposure >= CPU_STRIKE_THRESHOLDS[difficulty ?? 'medium']
}
