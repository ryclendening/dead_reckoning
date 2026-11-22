const RADAR_RANGE_HELP = 'Linked SAMs can fire anywhere inside the radar’s dashed circle. Linked AAA gets 50% more range around the gun.'
export const RADAR_PLACEMENT_HELP = `Place SAM and AAA inside your radar’s dashed circle. ${RADAR_RANGE_HELP}`
export const formatDefenseRange = (range: number) => String(Number(range.toFixed(2)))
