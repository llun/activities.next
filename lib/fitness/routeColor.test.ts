import { ROUTE_LINE_COLOR } from '@/lib/components/fitness/routeLineStyle'

import { ROUTE_COLOR } from './routeColor'

describe('routeColor', () => {
  it("is the design system's Brand/Primary orange", () => {
    expect(ROUTE_COLOR).toBe('#E55F06')
  })

  it('is what the interactive map draws the route line in', () => {
    expect(ROUTE_LINE_COLOR).toBe(ROUTE_COLOR)
  })
})
