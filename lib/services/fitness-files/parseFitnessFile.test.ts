import FitParser from 'fit-file-parser'

import { parseFitnessFile } from './parseFitnessFile'

vi.mock('fit-file-parser', () => {
  return {
    default: vi.fn().mockImplementation(function () {
      return {
        parse: (
          _buffer: Buffer,
          callback: (error: Error | null, data?: unknown) => void
        ) => callback(null, {})
      }
    })
  }
})

const FitParserMock = FitParser as unknown as jest.Mock

describe('parseFitnessFile', () => {
  beforeEach(() => {
    FitParserMock.mockClear()
  })

  it('parses GPX content into normalized activity data', async () => {
    const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="tests">
  <metadata>
    <time>2026-01-01T10:00:00Z</time>
  </metadata>
  <trk>
    <type>running</type>
    <trkseg>
      <trkpt lat="37.7749" lon="-122.4194">
        <ele>10</ele>
        <time>2026-01-01T10:00:00Z</time>
      </trkpt>
      <trkpt lat="37.7759" lon="-122.4184">
        <ele>35</ele>
        <time>2026-01-01T10:10:00Z</time>
      </trkpt>
    </trkseg>
  </trk>
</gpx>`

    const parsed = await parseFitnessFile({
      fileType: 'gpx',
      buffer: Buffer.from(gpx)
    })

    expect(parsed.coordinates).toHaveLength(2)
    expect(parsed.totalDistanceMeters).toBeGreaterThan(100)
    expect(parsed.totalDurationSeconds).toBe(600)
    expect(parsed.elevationGainMeters).toBe(25)
    expect(parsed.activityType).toBe('running')
    expect(parsed.startTime?.toISOString()).toBe('2026-01-01T10:00:00.000Z')
  })

  it('parses TCX data and prefers lap metadata for distance/duration', async () => {
    const tcx = `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase>
  <Activities>
    <Activity Sport="Biking">
      <Id>2026-01-02T07:00:00Z</Id>
      <Lap StartTime="2026-01-02T07:00:00Z">
        <TotalTimeSeconds>1800</TotalTimeSeconds>
        <DistanceMeters>12345.6</DistanceMeters>
        <Track>
          <Trackpoint>
            <Time>2026-01-02T07:00:00Z</Time>
            <Position>
              <LatitudeDegrees>37.7800</LatitudeDegrees>
              <LongitudeDegrees>-122.4100</LongitudeDegrees>
            </Position>
            <AltitudeMeters>20</AltitudeMeters>
          </Trackpoint>
          <Trackpoint>
            <Time>2026-01-02T07:30:00Z</Time>
            <Position>
              <LatitudeDegrees>37.7900</LatitudeDegrees>
              <LongitudeDegrees>-122.4000</LongitudeDegrees>
            </Position>
            <AltitudeMeters>55</AltitudeMeters>
          </Trackpoint>
        </Track>
      </Lap>
    </Activity>
  </Activities>
</TrainingCenterDatabase>`

    const parsed = await parseFitnessFile({
      fileType: 'tcx',
      buffer: Buffer.from(tcx)
    })

    expect(parsed.coordinates).toHaveLength(2)
    expect(parsed.totalDistanceMeters).toBeCloseTo(12_345.6, 3)
    expect(parsed.totalDurationSeconds).toBe(1800)
    expect(parsed.elevationGainMeters).toBe(35)
    expect(parsed.activityType).toBe('Biking')
    expect(parsed.startTime?.toISOString()).toBe('2026-01-02T07:00:00.000Z')
  })

  it('computes moving time from trackpoints, excluding stopped segments', async () => {
    // The activity spans 600s of elapsed time, but the rider is stopped
    // (ns3:Speed 0) for the first 120s. Moving time should exclude that stop:
    // 600 - 120 = 480s. This is what makes distance/moving-time (Strava's
    // average speed) higher than distance/elapsed-time.
    const speedExt = (metersPerSecond: number) =>
      `<Extensions><ns3:TPX xmlns:ns3="http://www.garmin.com/xmlschemas/ActivityExtension/v2"><ns3:Speed>${metersPerSecond}</ns3:Speed></ns3:TPX></Extensions>`
    const tcx = `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase>
  <Activities>
    <Activity Sport="Biking">
      <Id>2026-02-01T07:00:00Z</Id>
      <Lap StartTime="2026-02-01T07:00:00Z">
        <TotalTimeSeconds>600</TotalTimeSeconds>
        <DistanceMeters>4000</DistanceMeters>
        <Track>
          <Trackpoint>
            <Time>2026-02-01T07:00:00Z</Time>
            <Position><LatitudeDegrees>37.7800</LatitudeDegrees><LongitudeDegrees>-122.4100</LongitudeDegrees></Position>
            ${speedExt(0)}
          </Trackpoint>
          <Trackpoint>
            <Time>2026-02-01T07:02:00Z</Time>
            <Position><LatitudeDegrees>37.7800</LatitudeDegrees><LongitudeDegrees>-122.4100</LongitudeDegrees></Position>
            ${speedExt(0)}
          </Trackpoint>
          <Trackpoint>
            <Time>2026-02-01T07:05:00Z</Time>
            <Position><LatitudeDegrees>37.7850</LatitudeDegrees><LongitudeDegrees>-122.4050</LongitudeDegrees></Position>
            ${speedExt(8)}
          </Trackpoint>
          <Trackpoint>
            <Time>2026-02-01T07:10:00Z</Time>
            <Position><LatitudeDegrees>37.7900</LatitudeDegrees><LongitudeDegrees>-122.4000</LongitudeDegrees></Position>
            ${speedExt(8)}
          </Trackpoint>
        </Track>
      </Lap>
    </Activity>
  </Activities>
</TrainingCenterDatabase>`

    const parsed = await parseFitnessFile({
      fileType: 'tcx',
      buffer: Buffer.from(tcx)
    })

    expect(parsed.totalDurationSeconds).toBe(600)
    expect(parsed.movingTimeSeconds).toBe(480)
  })

  it('derives moving time from GPS movement when trackpoints have no per-point speed (GPX)', async () => {
    // A GPX with timestamps but no speed extension — common for plain exports.
    // The rider is stationary (identical lat/lng) for the first 120s, then
    // moves. Moving time must be derived from GPS distance/Δt and exclude the
    // stationary span: 600 - 120 = 480s.
    const trkpt = (time: string, lat: number, lon: number) =>
      `<trkpt lat="${lat}" lon="${lon}"><time>${time}</time></trkpt>`
    const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="tests" xmlns="http://www.topografix.com/GPX/1/1">
  <trk><trkseg>
    ${trkpt('2026-02-01T07:00:00Z', 52.01, 5.6784)}
    ${trkpt('2026-02-01T07:02:00Z', 52.01, 5.6784)}
    ${trkpt('2026-02-01T07:05:00Z', 52.03, 5.7)}
    ${trkpt('2026-02-01T07:10:00Z', 52.06, 5.73)}
  </trkseg></trk>
</gpx>`

    const parsed = await parseFitnessFile({
      fileType: 'gpx',
      buffer: Buffer.from(gpx)
    })

    expect(parsed.totalDurationSeconds).toBe(600)
    expect(parsed.movingTimeSeconds).toBe(480)
  })

  it('leaves moving time undefined when trackpoints have no timestamps (TCX)', async () => {
    // Without per-point timestamps there is nothing to measure moving time
    // from, so it stays undefined and callers fall back to the lap elapsed time.
    const tcx = `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase>
  <Activities><Activity Sport="Biking"><Lap>
    <TotalTimeSeconds>1800</TotalTimeSeconds>
    <DistanceMeters>12000</DistanceMeters>
    <Track>
      <Trackpoint><Position><LatitudeDegrees>37.78</LatitudeDegrees><LongitudeDegrees>-122.41</LongitudeDegrees></Position></Trackpoint>
      <Trackpoint><Position><LatitudeDegrees>37.79</LatitudeDegrees><LongitudeDegrees>-122.40</LongitudeDegrees></Position></Trackpoint>
    </Track>
  </Lap></Activity></Activities>
</TrainingCenterDatabase>`

    const parsed = await parseFitnessFile({
      fileType: 'tcx',
      buffer: Buffer.from(tcx)
    })

    expect(parsed.totalDurationSeconds).toBe(1800)
    expect(parsed.movingTimeSeconds).toBeUndefined()
  })

  it('reports moving time equal to elapsed time for a ride with no stops (TCX)', async () => {
    const tp = (time: string, lat: number, lon: number, mps: number) =>
      `<Trackpoint><Time>${time}</Time><Position><LatitudeDegrees>${lat}</LatitudeDegrees><LongitudeDegrees>${lon}</LongitudeDegrees></Position><Extensions><ns3:TPX xmlns:ns3="http://www.garmin.com/xmlschemas/ActivityExtension/v2"><ns3:Speed>${mps}</ns3:Speed></ns3:TPX></Extensions></Trackpoint>`
    const tcx = `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase>
  <Activities><Activity Sport="Biking"><Lap>
    <TotalTimeSeconds>180</TotalTimeSeconds>
    <DistanceMeters>1500</DistanceMeters>
    <Track>
      ${tp('2026-02-01T07:00:00Z', 52.01, 5.678, 8)}
      ${tp('2026-02-01T07:01:00Z', 52.015, 5.685, 8)}
      ${tp('2026-02-01T07:02:00Z', 52.02, 5.692, 8)}
      ${tp('2026-02-01T07:03:00Z', 52.025, 5.699, 8)}
    </Track>
  </Lap></Activity></Activities>
</TrainingCenterDatabase>`

    const parsed = await parseFitnessFile({
      fileType: 'tcx',
      buffer: Buffer.from(tcx)
    })

    expect(parsed.totalDurationSeconds).toBe(180)
    expect(parsed.movingTimeSeconds).toBe(180)
  })

  it('clamps moving time to the elapsed duration when the lap total is shorter than the trackpoint span (TCX)', async () => {
    // The lap reports 300s elapsed, but the trackpoints span 600s with no
    // stops. Moving time must never exceed elapsed time, so it is clamped to
    // 300 rather than the raw 600 the segments would sum to.
    const tp = (time: string, lat: number, lon: number, mps: number) =>
      `<Trackpoint><Time>${time}</Time><Position><LatitudeDegrees>${lat}</LatitudeDegrees><LongitudeDegrees>${lon}</LongitudeDegrees></Position><Extensions><ns3:TPX xmlns:ns3="http://www.garmin.com/xmlschemas/ActivityExtension/v2"><ns3:Speed>${mps}</ns3:Speed></ns3:TPX></Extensions></Trackpoint>`
    const tcx = `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase>
  <Activities><Activity Sport="Biking"><Lap>
    <TotalTimeSeconds>300</TotalTimeSeconds>
    <DistanceMeters>5000</DistanceMeters>
    <Track>
      ${tp('2026-02-01T07:00:00Z', 52.01, 5.678, 8)}
      ${tp('2026-02-01T07:05:00Z', 52.03, 5.7, 8)}
      ${tp('2026-02-01T07:10:00Z', 52.06, 5.73, 8)}
    </Track>
  </Lap></Activity></Activities>
</TrainingCenterDatabase>`

    const parsed = await parseFitnessFile({
      fileType: 'tcx',
      buffer: Buffer.from(tcx)
    })

    expect(parsed.totalDurationSeconds).toBe(300)
    expect(parsed.movingTimeSeconds).toBe(300)
  })

  it('computes moving time from FIT records, excluding stopped segments', async () => {
    // fit-file-parser is configured with speedUnit 'km/h', so record.speed is
    // already km/h here. The rider is stopped (speed 0) for the first 120s.
    FitParserMock.mockImplementation(function () {
      return {
        parse: (
          _buffer: Buffer,
          callback: (error: Error | null, data?: unknown) => void
        ) =>
          callback(null, {
            sessions: [
              {
                total_distance: 4_000,
                total_elapsed_time: 600,
                sport: 'cycling',
                start_time: '2026-02-01T07:00:00Z'
              }
            ],
            records: [
              {
                position_lat: 52.01,
                position_long: 5.6784,
                timestamp: '2026-02-01T07:00:00Z',
                speed: 0
              },
              {
                position_lat: 52.01,
                position_long: 5.6784,
                timestamp: '2026-02-01T07:02:00Z',
                speed: 0
              },
              {
                position_lat: 52.03,
                position_long: 5.7,
                timestamp: '2026-02-01T07:05:00Z',
                speed: 28.8
              },
              {
                position_lat: 52.06,
                position_long: 5.73,
                timestamp: '2026-02-01T07:10:00Z',
                speed: 28.8
              }
            ]
          })
      }
    })

    const parsed = await parseFitnessFile({
      fileType: 'fit',
      buffer: Buffer.from('binary-fit-content')
    })

    expect(parsed.totalDurationSeconds).toBe(600)
    expect(parsed.movingTimeSeconds).toBe(480)
  })

  it('parses FIT data from fit-file-parser output', async () => {
    FitParserMock.mockImplementation(function () {
      return {
        parse: (
          _buffer: Buffer,
          callback: (error: Error | null, data?: unknown) => void
        ) =>
          callback(null, {
            sessions: [
              {
                total_distance: 5_000,
                total_elapsed_time: 1_500,
                total_ascent: 140,
                sport: 'running',
                start_time: '2026-01-03T06:00:00Z'
              }
            ],
            records: [
              {
                position_lat: 37.78,
                position_long: -122.42,
                altitude: 10,
                timestamp: '2026-01-03T06:00:00Z'
              },
              {
                position_lat: 37.79,
                position_long: -122.41,
                altitude: 20,
                timestamp: '2026-01-03T06:25:00Z'
              }
            ]
          })
      }
    })

    const parsed = await parseFitnessFile({
      fileType: 'fit',
      buffer: Buffer.from('binary-fit-content')
    })

    expect(parsed.coordinates).toHaveLength(2)
    expect(parsed.totalDistanceMeters).toBe(5_000)
    expect(parsed.totalDurationSeconds).toBe(1_500)
    expect(parsed.elevationGainMeters).toBe(140)
    expect(parsed.activityType).toBe('running')
    expect(parsed.startTime?.toISOString()).toBe('2026-01-03T06:00:00.000Z')
  })

  it('throws when FIT parser reports an error', async () => {
    FitParserMock.mockImplementation(function () {
      return {
        parse: (
          _buffer: Buffer,
          callback: (error: Error | null, data?: unknown) => void
        ) => callback(new Error('failed to parse fit'))
      }
    })

    await expect(
      parseFitnessFile({
        fileType: 'fit',
        buffer: Buffer.from('bad-fit-content')
      })
    ).rejects.toThrow('failed to parse fit')
  })
})
