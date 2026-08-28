import {describe,expect,it} from 'vitest'
import {deriveFogMaskSize} from './fog'
import {generateCampaignWorld} from './world'

describe('fog mask sizing',()=>{
  it('keeps the two generated-world masks within the 72 KB budget',()=>{const size=deriveFogMaskSize(generateCampaignWorld(7301).presentationBounds);expect(size).toEqual({width:160,height:192});expect(size.width*size.height*2).toBeLessThanOrEqual(72*1024)})
})
