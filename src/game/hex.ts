import type { Point } from './types'

export const HEX_RADIUS=.78
export const HEX_WIDTH=Math.sqrt(3)*HEX_RADIUS
export const HEX_ROW=1.5*HEX_RADIUS

const cubeRound=(q:number,r:number):[number,number]=>{
  const x=q,z=r,y=-x-z;let rx=Math.round(x),ry=Math.round(y),rz=Math.round(z)
  const dx=Math.abs(rx-x),dy=Math.abs(ry-y),dz=Math.abs(rz-z)
  if(dx>dy&&dx>dz)rx=-ry-rz;else if(dy>dz)ry=-rx-rz;else rz=-rx-ry
  return [rx,rz]
}

export const axialToPoint=(q:number,r:number):Point=>[HEX_RADIUS*Math.sqrt(3)*(q+r/2),HEX_RADIUS*1.5*r]

export function snapToHex(point:Point):Point{
  const q=(Math.sqrt(3)/3*point[0]-point[1]/3)/HEX_RADIUS
  const r=(2/3*point[1])/HEX_RADIUS
  const [rq,rr]=cubeRound(q,r)
  return axialToPoint(rq,rr)
}
