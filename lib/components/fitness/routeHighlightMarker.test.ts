import {
  ROUTE_HIGHLIGHT_HIDDEN_CORE_COLOR,
  getRouteHighlightCoreColor
} from './routeHighlightMarker'

describe('getRouteHighlightCoreColor', () => {
  it.each([
    {
      description: 'green on a privacy-hidden segment',
      isHiddenByPrivacy: true,
      expected: ROUTE_HIGHLIGHT_HIDDEN_CORE_COLOR
    }
  ])('returns $description', ({ isHiddenByPrivacy, expected }) => {
    expect(getRouteHighlightCoreColor(isHiddenByPrivacy)).toBe(expected)
  })
})
