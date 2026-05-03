export interface Coordinate {
  lat: number
  lng: number
}

export interface CoordinateBounds {
  minLat: number
  maxLat: number
  minLng: number
  maxLng: number
}

export const TILE_SIZE = 256
export const MIN_LATITUDE = -85.05112878
export const MAX_LATITUDE = 85.05112878

export const clampLatitude = (latitude: number) =>
  Math.min(MAX_LATITUDE, Math.max(MIN_LATITUDE, latitude))

export const normalizeLongitude = (longitude: number) => {
  if (longitude > 180) return longitude - 360
  if (longitude < -180) return longitude + 360
  return longitude
}

export const projectWebMercator = (coordinate: Coordinate, zoom: number) => {
  const scale = 2 ** zoom * TILE_SIZE
  const lng = normalizeLongitude(coordinate.lng)
  const lat = clampLatitude(coordinate.lat)

  const x = ((lng + 180) / 360) * scale
  const latRad = (lat * Math.PI) / 180
  const y =
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) *
    scale

  return { x, y }
}

export const calculateCoordinateBounds = (
  coordinates: Coordinate[]
): CoordinateBounds => {
  let minLat = Number.POSITIVE_INFINITY
  let maxLat = Number.NEGATIVE_INFINITY
  let minLng = Number.POSITIVE_INFINITY
  let maxLng = Number.NEGATIVE_INFINITY

  for (const coordinate of coordinates) {
    minLat = Math.min(minLat, coordinate.lat)
    maxLat = Math.max(maxLat, coordinate.lat)
    minLng = Math.min(minLng, coordinate.lng)
    maxLng = Math.max(maxLng, coordinate.lng)
  }

  return {
    minLat,
    maxLat,
    minLng,
    maxLng
  }
}

export const isFiniteBounds = (bounds: CoordinateBounds) =>
  Number.isFinite(bounds.minLat) &&
  Number.isFinite(bounds.maxLat) &&
  Number.isFinite(bounds.minLng) &&
  Number.isFinite(bounds.maxLng)

export const getZoomLevelForBounds = ({
  coordinates,
  bounds: precomputedBounds,
  width,
  height,
  padding
}: {
  coordinates?: Coordinate[]
  bounds?: CoordinateBounds
  width: number
  height: number
  padding: number
}) => {
  const bounds =
    precomputedBounds ??
    (coordinates && coordinates.length > 0
      ? calculateCoordinateBounds(coordinates)
      : null)

  if (!bounds) return 2

  for (let zoom = 18; zoom >= 2; zoom -= 1) {
    const p1 = projectWebMercator(
      { lat: bounds.minLat, lng: bounds.minLng },
      zoom
    )
    const p2 = projectWebMercator(
      { lat: bounds.maxLat, lng: bounds.maxLng },
      zoom
    )
    const minX = Math.min(p1.x, p2.x)
    const maxX = Math.max(p1.x, p2.x)
    const minY = p2.y
    const maxY = p1.y

    if (
      maxX - minX <= width - padding * 2 &&
      maxY - minY <= height - padding * 2
    ) {
      return zoom
    }
  }

  return 2
}
