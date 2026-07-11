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

  it('derives FIT distance from a very long record list without overflowing the call stack', async () => {
    const recordCount = 200_000
    FitParserMock.mockImplementation(function () {
      return {
        parse: (
          _buffer: Buffer,
          callback: (error: Error | null, data?: unknown) => void
        ) =>
          // No session totals, so the record-distance fallback runs. A
          // `Math.max(...samples)` spread over this many records would throw a
          // RangeError; the reduce must handle it.
          callback(null, {
            sessions: [],
            records: Array.from({ length: recordCount }, (_value, index) => ({
              position_lat: 37.78 + index * 0.00001,
              position_long: -122.42 + index * 0.00001,
              distance: index
            }))
          })
      }
    })

    const parsed = await parseFitnessFile({
      fileType: 'fit',
      buffer: Buffer.from('binary-fit-content')
    })

    expect(parsed.totalDistanceMeters).toBe(recordCount - 1)
  })

  it('caps the decoded trackpoints for an oversized activity', async () => {
    const recordCount = 400_000
    FitParserMock.mockImplementation(function () {
      return {
        parse: (
          _buffer: Buffer,
          callback: (error: Error | null, data?: unknown) => void
        ) =>
          callback(null, {
            sessions: [{ total_distance: 1000 }],
            records: Array.from({ length: recordCount }, (_value, index) => ({
              position_lat: 37.78 + index * 0.00001,
              position_long: -122.42 + index * 0.00001
            }))
          })
      }
    })

    const parsed = await parseFitnessFile({
      fileType: 'fit',
      buffer: Buffer.from('binary-fit-content')
    })

    // Every record carries GPS, so without the cap coordinates would equal the
    // full record count. The cap keeps peak memory bounded so the worker cannot
    // OOM-abort mid-job on a very large activity.
    expect(parsed.coordinates.length).toBeGreaterThan(0)
    expect(parsed.coordinates.length).toBeLessThan(recordCount)
    expect(parsed.coordinates.length).toBeLessThanOrEqual(100_000)
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
