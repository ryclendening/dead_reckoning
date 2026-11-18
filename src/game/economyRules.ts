export const LOGISTICS_COSTS = { formationRepair: 2, aircraftReplacement: 4, upgrade: 12, fobConstruction: 8, decoyConstruction: 4, aaaConstruction: 6, samConstruction: 14, radarConstruction: 18 } as const
export const LOGISTICS_EFFECTS = { formationRepair: 25, baseIncome: 8, intelRecovery: 2, confirmedEnemyAircraft: 1, supplyDepotIncome: 2 } as const

export const FORMATION_PRICES = { fighter: 16, recon: 12, bomber: 24 } as const

export const canAffordFormation = (cash: number): boolean => cash >= Math.min(FORMATION_PRICES.fighter, FORMATION_PRICES.recon, FORMATION_PRICES.bomber)

// Stable saved economy units are worth ten million dollars each.
const cashNumber = new Intl.NumberFormat('en-US')
export const formatCash = (units: number): string => `$${cashNumber.format(units * 10)}M`
