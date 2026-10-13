export interface FrameClock {
  time: number
  target: number
  lastTarget: number
  lastTargetWallTime: number
  rate: number
}

export function createFrameClock(time: number, wallTime = 0): FrameClock {
  return { time, target: time, lastTarget: time, lastTargetWallTime: wallTime, rate: 1 }
}

/** Smoothly follows fixed simulation snapshots at their observed playback rate. */
export function advanceFrameClock(clock: FrameClock, target: number, wallTime: number, delta: number): number {
  if(target===clock.lastTarget&&clock.lastTargetWallTime===0){clock.lastTargetWallTime=wallTime;clock.target=target;return clock.time}
  if (target !== clock.lastTarget) {
    const elapsed = wallTime - clock.lastTargetWallTime
    const simulated = target - clock.lastTarget
    if (elapsed > 0 && simulated > 0) clock.rate = simulated / elapsed
    clock.lastTarget = target
    clock.lastTargetWallTime = wallTime
  }
  clock.target = target
  clock.time = Math.max(clock.time, Math.min(target, clock.time + Math.max(0, delta) * clock.rate))
  return clock.time
}
