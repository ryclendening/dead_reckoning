/** Shared opening condition for corresponding player and CPU formations. */
export const OPENING_CONDITION = {
  fighter: { aircraft: 4, maxAircraft: 4, damaged: 0, strength: 100, ammo: 100, readiness: 92, morale: 86 },
  secondFighter: { aircraft: 4, maxAircraft: 4, damaged: 0, strength: 100, ammo: 100, readiness: 89, morale: 78 },
  recon: { aircraft: 4, maxAircraft: 4, damaged: 0, strength: 100, ammo: 100, readiness: 96, morale: 84 },
} as const
export const OPENING_LOGISTICS = 10
export const OPENING_RESERVES = 3
