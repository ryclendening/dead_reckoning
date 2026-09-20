import type { Asset, Squadron } from './types'
import { isAirfield, normalizeFormationBasing } from './forwardBasing'

export interface FormationBaseGroup {
  base: Asset
  formationIds: string[]
}

/**
 * Project the current basing state into UI groups without inventing a rebasing
 * mechanic. Explicit FOB assignments win; every unassigned formation belongs
 * to the main airfield.
 */
export function formationBaseGroups(squadrons: Squadron[], assets: Asset[]): FormationBaseGroup[] {
  assets = normalizeFormationBasing(squadrons, assets)
  const formationIds = new Set(squadrons.map(squadron => squadron.id))
  const airfields = assets.filter(isAirfield)
  const main = airfields.find(asset => asset.kind === 'base')
  const forwards = airfields.filter(asset => asset.kind === 'fob')
  const claimed = new Set<string>()

  const claim = (ids: string[]) => ids.reduce<string[]>((result, id) => {
    if (!formationIds.has(id) || claimed.has(id)) return result
    claimed.add(id)
    result.push(id)
    return result
  }, [])

  const forwardGroups = forwards.map(base => {
    const ids = claim(base.basedFormationIds ?? [])
    return { base, formationIds: ids }
  })

  const mainIds = claim(main?.basedFormationIds ?? [])
  squadrons.forEach(squadron => {
    if (!claimed.has(squadron.id)) {
      mainIds.push(squadron.id)
      claimed.add(squadron.id)
    }
  })

  return main ? [{ base: main, formationIds: mainIds }, ...forwardGroups] : forwardGroups
}

export function formationBaseId(groups: FormationBaseGroup[], formationId: string): string | undefined {
  return groups.find(group => group.formationIds.includes(formationId))?.base.id
}

export const airfieldLabel = (asset: Asset) => asset.kind === 'base' ? 'HOME BASE' : asset.name ?? 'FORWARD BASE'
