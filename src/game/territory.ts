import type { Asset, FriendlyTerritory, Point, TerritoryRegion, WorldBounds } from './types'

export const FOB_TERRITORY_RADIUS = 3
const HOME_REGION_ID = 'home-territory'

const distance = (left:Point,right:Point) => Math.hypot(left[0]-right[0],left[1]-right[1])

export function territoryRegions(territory:FriendlyTerritory):TerritoryRegion[] {
  return territory.regions?.length ? territory.regions : [{id:HOME_REGION_ID,kind:'home',center:[...territory.center],radius:territory.radius}]
}

export function friendlyTerritoryForAssets(base:FriendlyTerritory, assets:Pick<Asset,'id'|'kind'|'position'|'health'|'operational'>[]):FriendlyTerritory {
  const regions:TerritoryRegion[]=[{id:HOME_REGION_ID,kind:'home',center:[...base.center],radius:base.radius}]
  for(const asset of assets){
    if(asset.kind!=='fob'||asset.health<=0||asset.operational===false)continue
    regions.push({id:asset.id,kind:'fob',center:[...asset.position],radius:FOB_TERRITORY_RADIUS})
  }
  return {...base,regions}
}

export function territoryContains(point:Point, territory:FriendlyTerritory, edgeMargin=0):boolean {
  return territoryRegions(territory).some(region=>distance(point,region.center)<=region.radius-edgeMargin+1e-7)
}

export function territoryBounds(territory:FriendlyTerritory):WorldBounds {
  const regions=territoryRegions(territory)
  return regions.reduce((bounds,region)=>({
    minX:Math.min(bounds.minX,region.center[0]-region.radius),
    maxX:Math.max(bounds.maxX,region.center[0]+region.radius),
    minZ:Math.min(bounds.minZ,region.center[1]-region.radius),
    maxZ:Math.max(bounds.maxZ,region.center[1]+region.radius),
  }),{minX:Infinity,maxX:-Infinity,minZ:Infinity,maxZ:-Infinity})
}
