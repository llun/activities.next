import {
  ROUTE_HIGHLIGHT_CORE_COLOR,
  ROUTE_HIGHLIGHT_HIDDEN_CORE_COLOR,
  getRouteHighlightCoreColor
} from './routeHighlightMarker'

describe('getRouteHighlightCoreColor', () => {
  it.each([
    {
      description: 'blue on a shared segment',
      isHiddenByPrivacy: false,
      expected: ROUTE_HIGHLIGHT_CORE_COLOR
    },
    {
      description: 'green on a privacy-hidden segment',
      isHiddenByPrivacy: true,
      expected: ROUTE_HIGHLIGHT_HIDDEN_CORE_COLOR
    }
  ])('returns $description', ({ isHiddenByPrivacy, expected }) => {
    expect(getRouteHighlightCoreColor(isHiddenByPrivacy)).toBe(expected)
  })
})
