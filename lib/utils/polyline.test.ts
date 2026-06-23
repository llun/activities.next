import { encodePolyline } from './polyline'

describe('encodePolyline', () => {
  it('matches the canonical Google polyline example', () => {
    // The reference example from the Encoded Polyline Algorithm Format docs.
    const encoded = encodePolyline([
      { lat: 38.5, lng: -120.2 },
      { lat: 40.7, lng: -120.95 },
      { lat: 43.252, lng: -126.453 }
    ])

    expect(encoded).toBe('_p~iF~ps|U_ulLnnqC_mqNvxq`@')
  })

  it('returns an empty string for no points', () => {
    expect(encodePolyline([])).toBe('')
  })

  it('round-trips through decoding back to the original points', () => {
    const points = [
      { lat: 52.379189, lng: 4.899431 },
      { lat: 52.37, lng: 4.9 },
      { lat: 52.36, lng: 4.91 }
    ]
    const decoded = decodePolyline(encodePolyline(points))

    expect(decoded).toHaveLength(points.length)
    decoded.forEach((point, index) => {
      expect(point.lat).toBeCloseTo(points[index].lat, 5)
      expect(point.lng).toBeCloseTo(points[index].lng, 5)
    })
  })
})

// Minimal decoder kept local to the test to verify the encoder round-trips.
const decodePolyline = (
  encoded: string,
  precision = 5
): Array<{ lat: number; lng: number }> => {
  const factor = 10 ** precision
  const points: Array<{ lat: number; lng: number }> = []
  let index = 0
  let lat = 0
  let lng = 0

  const readValue = () => {
    let shift = 0
    let result = 0
    let byte: number
    do {
      byte = encoded.charCodeAt(index++) - 63
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20)
    return result & 1 ? ~(result >> 1) : result >> 1
  }

  while (index < encoded.length) {
    lat += readValue()
    lng += readValue()
    points.push({ lat: lat / factor, lng: lng / factor })
  }

  return points
}
