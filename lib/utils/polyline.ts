/**
 * Google Encoded Polyline Algorithm Format encoder.
 *
 * Used to compress route geometry into the compact overlays the static map APIs
 * accept — the Mapbox Static Images API `path(...)` overlay and the Apple Maps
 * Snapshots `overlays[].points` value — so many route vertices fit inside each
 * provider's URL-length limit. Precision 5 (1e5) is the default both providers
 * expect for encoded polyline overlays.
 *
 * https://developers.google.com/maps/documentation/utilities/polylinealgorithm
 */

interface LatLng {
  lat: number
  lng: number
}

const encodeSignedNumber = (value: number): string => {
  // Left-shift by one bit, then invert if negative (zig-zag encoding). The
  // values here (coordinate * 1e5) stay well within 32-bit range.
  let shifted = value << 1
  if (value < 0) {
    shifted = ~shifted
  }

  let result = ''
  while (shifted >= 0x20) {
    result += String.fromCharCode((0x20 | (shifted & 0x1f)) + 63)
    shifted >>= 5
  }
  result += String.fromCharCode(shifted + 63)
  return result
}

export const encodePolyline = (points: LatLng[], precision = 5): string => {
  const factor = 10 ** precision
  let previousLat = 0
  let previousLng = 0
  let result = ''

  for (const point of points) {
    const lat = Math.round(point.lat * factor)
    const lng = Math.round(point.lng * factor)
    result += encodeSignedNumber(lat - previousLat)
    result += encodeSignedNumber(lng - previousLng)
    previousLat = lat
    previousLng = lng
  }

  return result
}
