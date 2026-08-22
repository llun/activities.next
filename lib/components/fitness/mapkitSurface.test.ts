import {
  MAPKIT_MUTED_STANDARD_MAP_TYPE,
  type MapKitSurfaceModule,
  mutedStandardMapType
} from './mapkitSurface'

// Only the `Map` static matters to the map-type lookup, so the rest of the
// MapKit surface is left off — nothing here ever touches it.
const moduleWithMapTypes = (
  mapTypes?: MapKitSurfaceModule['Map']['MapTypes']
): MapKitSurfaceModule => {
  const mapConstructor =
    function Map() {} as unknown as MapKitSurfaceModule['Map']
  mapConstructor.MapTypes = mapTypes
  return { Map: mapConstructor } as MapKitSurfaceModule
}

describe('mutedStandardMapType', () => {
  it("reads the muted standard constant off MapKit's own basemap enum", () => {
    expect(
      mutedStandardMapType(
        moduleWithMapTypes({ MutedStandard: 'mutedStandard' })
      )
    ).toBe('mutedStandard')
  })

  it.each([
    { description: 'MapTypes is missing entirely', mapTypes: undefined },
    { description: 'MapTypes carries no MutedStandard', mapTypes: {} }
  ])(
    'falls back to the literal rather than throwing when $description',
    ({ mapTypes }) => {
      // Every component constructs its map inside a `try` that drops the whole
      // map to the static fallback renderer on throw, so this lookup must never
      // be the thing that costs a reader their Apple map.
      expect(mutedStandardMapType(moduleWithMapTypes(mapTypes))).toBe(
        MAPKIT_MUTED_STANDARD_MAP_TYPE
      )
    }
  )
})
