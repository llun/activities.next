import { buildRouteHeatmapPayload } from '@/lib/services/fitness-files/routeHeatmap'

describe('buildRouteHeatmapPayload', () => {
  it('normalizes coordinates to six decimal places without string formatting', () => {
    const payload = buildRouteHeatmapPayload({
      privacySegments: [
        {
          isHiddenByPrivacy: false,
          points: [
            {
              lat: 52.1234564,
              lng: 4.9876544,
              isHiddenByPrivacy: false
            },
            {
              lat: 52.1234567,
              lng: 4.9876547,
              isHiddenByPrivacy: false
            }
          ]
        }
      ]
    })

    expect(payload.segments).toEqual([
      {
        points: [
          { lat: 52.123456, lng: 4.987654 },
          { lat: 52.123457, lng: 4.987655 }
        ]
      }
    ])
  })
})
