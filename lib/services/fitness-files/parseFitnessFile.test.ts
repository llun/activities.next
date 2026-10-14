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
    // Stored canonically, not as the raw `running` the file carried.
    expect(parsed.activityType).toBe('run')
    expect(parsed.rawActivityType).toBe('running')
    expect(parsed.startTime?.toISOString()).toBe('2026-01-01T10:00:00.000Z')
  })

  it('keeps the raw sport beside the key when the key is coarser', async () => {
    // `Handcycle` normalizes to `ride` because gear attribution asks "which
    // bike". The caption is not asking that, so the raw spelling has to
    // survive parsing or a directly uploaded handcycle ride is captioned
    // "Cycling" while the same ride imported from Strava says "Handcycling".
    const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="tests">
  <trk>
    <type>Handcycle</type>
    <trkseg>
      <trkpt lat="37.7749" lon="-122.4194"><time>2026-01-01T10:00:00Z</time></trkpt>
      <trkpt lat="37.7759" lon="-122.4184"><time>2026-01-01T10:10:00Z</time></trkpt>
    </trkseg>
  </trk>
</gpx>`

    const parsed = await parseFitnessFile({
      fileType: 'gpx',
      buffer: Buffer.from(gpx)
    })

    expect(parsed.activityType).toBe('ride')
    expect(parsed.rawActivityType).toBe('Handcycle')
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
    expect(parsed.activityType).toBe('ride')
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
    expect(parsed.activityType).toBe('run')
    expect(parsed.startTime?.toISOString()).toBe('2026-01-03T06:00:00.000Z')
  })

  it('extracts summary metrics from FIT primary session', async () => {
    FitParserMock.mockImplementation(function () {
      return {
        parse: (
          _buffer: Buffer,
          callback: (error: Error | null, data?: unknown) => void
        ) =>
          callback(null, {
            sessions: [
              {
                total_distance: 10_000,
                total_elapsed_time: 1_200,
                sport: 'cycling',
                start_time: '2026-01-03T06:00:00Z',
                avg_power: 215,
                max_power: 620,
                avg_heart_rate: 142,
                max_heart_rate: 175,
                total_work: 530_000 // 530 kJ in Joules
              }
            ],
            records: [
              {
                position_lat: 37.78,
                position_long: -122.42,
                power: 210,
                heart_rate: 140,
                altitude: 10,
                timestamp: '2026-01-03T06:00:00Z'
              },
              {
                position_lat: 37.79,
                position_long: -122.41,
                power: 220,
                heart_rate: 144,
                altitude: 20,
                timestamp: '2026-01-03T06:20:00Z'
              }
            ]
          })
      }
    })

    const parsed = await parseFitnessFile({
      fileType: 'fit',
      buffer: Buffer.from('binary-fit-content')
    })

    expect(parsed.avgPower).toBe(215)
    expect(parsed.maxPower).toBe(620)
    expect(parsed.avgHeartRate).toBe(142)
    expect(parsed.maxHeartRate).toBe(175)
    expect(parsed.totalWorkKj).toBe(530)
    expect(parsed.elevationSeries).toEqual([10, 20])
  })

  it('preserves power and heart rate for indoor FIT workouts without GPS coordinates', async () => {
    FitParserMock.mockImplementation(function () {
      return {
        parse: (
          _buffer: Buffer,
          callback: (error: Error | null, data?: unknown) => void
        ) =>
          callback(null, {
            sessions: [
              {
                total_distance: 8_000,
                total_elapsed_time: 900,
                sport: 'training',
                start_time: '2026-01-04T08:00:00Z'
              }
            ],
            // Indoor trainer records: NO position_lat or position_long
            records: [
              {
                power: 180,
                heart_rate: 135,
                speed: 30,
                timestamp: '2026-01-04T08:00:00Z'
              },
              {
                power: 220,
                heart_rate: 155,
                speed: 32,
                timestamp: '2026-01-04T08:15:00Z'
              }
            ]
          })
      }
    })

    const parsed = await parseFitnessFile({
      fileType: 'fit',
      buffer: Buffer.from('binary-fit-content')
    })

    expect(parsed.coordinates).toHaveLength(0)
    expect(parsed.powerSeries).toEqual([180, 220])
    expect(parsed.heartRateSeries).toEqual([135, 155])
    expect(parsed.avgPower).toBe(200)
    expect(parsed.maxPower).toBe(220)
    expect(parsed.avgHeartRate).toBe(145)
    expect(parsed.maxHeartRate).toBe(155)
    expect(parsed.totalWorkKj).toBe(180) // (200 * 900) / 1000 = 180 kJ
  })

  describe('cadence, temperature, balance, distance, laps and calories', () => {
    const mockFitOutput = (data: unknown) => {
      FitParserMock.mockImplementation(function () {
        return {
          parse: (
            _buffer: Buffer,
            callback: (error: Error | null, data?: unknown) => void
          ) => callback(null, data)
        }
      })
    }

    it('keeps FIT record metrics and converts balance to a left percentage', async () => {
      mockFitOutput({
        sessions: [
          {
            total_distance: 10_000,
            total_elapsed_time: 1_200,
            total_calories: 480,
            sport: 'cycling',
            start_time: '2026-01-03T06:00:00Z'
          }
        ],
        records: [
          {
            position_lat: 37.78,
            position_long: -122.42,
            timestamp: '2026-01-03T06:00:00Z',
            cadence: 88,
            temperature: 21,
            // fit-file-parser decodes the uint8 bitfield to { value, right }
            // where `right` flags that value is the RIGHT leg's share.
            left_right_balance: { value: 52, right: true },
            distance: 0
          },
          {
            position_lat: 37.79,
            position_long: -122.41,
            timestamp: '2026-01-03T06:00:10Z',
            cadence: 0,
            temperature: 22,
            // no right flag: the side is unknown, so there is no balance
            left_right_balance: { value: 47, right: false },
            distance: 83.5
          },
          {
            position_lat: 37.8,
            position_long: -122.4,
            timestamp: '2026-01-03T06:00:20Z',
            // raw 8-bit bitfield: 0x80 | 55
            left_right_balance: 0x80 | 55
          },
          {
            position_lat: 37.81,
            position_long: -122.39,
            timestamp: '2026-01-03T06:00:30Z',
            // raw 16-bit left_right_balance_100: flag 0x8000, 48.00% right
            left_right_balance: 0x8000 | 4800
          },
          {
            position_lat: 37.82,
            position_long: -122.38,
            timestamp: '2026-01-03T06:00:40Z',
            // 8-bit values above 100 are not a percentage
            left_right_balance: { value: 120, right: true }
          }
        ]
      })

      const parsed = await parseFitnessFile({
        fileType: 'fit',
        buffer: Buffer.from('binary-fit-content')
      })

      expect(parsed.calories).toBe(480)
      expect(parsed.trackPoints.map((point) => point.cadence)).toEqual([
        88,
        0,
        undefined,
        undefined,
        undefined
      ])
      expect(parsed.trackPoints.map((point) => point.temperature)).toEqual([
        21,
        22,
        undefined,
        undefined,
        undefined
      ])
      // right flag: 100 - right share; no flag: unknown; 16-bit: hundredths;
      // 8-bit above 100: invalid
      expect(parsed.trackPoints.map((point) => point.leftRightBalance)).toEqual(
        [48, undefined, 45, 52, undefined]
      )
      expect(parsed.trackPoints.map((point) => point.distanceMeters)).toEqual([
        0,
        83.5,
        undefined,
        undefined,
        undefined
      ])
    })

    it('maps FIT laps relative to the session start', async () => {
      mockFitOutput({
        sessions: [
          { start_time: '2026-01-03T06:00:00Z', total_elapsed_time: 900 }
        ],
        records: [
          {
            position_lat: 37.78,
            position_long: -122.42,
            timestamp: '2026-01-03T06:00:00Z'
          }
        ],
        laps: [
          {
            start_time: '2026-01-03T06:00:00Z',
            total_elapsed_time: 300,
            total_distance: 2_000,
            avg_power: 200,
            avg_heart_rate: 140,
            max_heart_rate: 160,
            avg_cadence: 85,
            avg_speed: 24,
            total_ascent: 12,
            total_calories: 70
          },
          {
            start_time: new Date('2026-01-03T06:05:00Z'),
            total_elapsed_time: 600,
            total_distance: 4_000
          }
        ]
      })

      const parsed = await parseFitnessFile({
        fileType: 'fit',
        buffer: Buffer.from('binary-fit-content')
      })

      expect(parsed.laps).toEqual([
        {
          startElapsedSeconds: 0,
          startTimestamp: Date.parse('2026-01-03T06:00:00Z'),
          durationSeconds: 300,
          distanceMeters: 2_000,
          avgPower: 200,
          avgHeartRate: 140,
          maxHeartRate: 160,
          avgCadence: 85,
          avgSpeed: 24,
          elevationGainMeters: 12,
          calories: 70
        },
        {
          startElapsedSeconds: 300,
          startTimestamp: Date.parse('2026-01-03T06:05:00Z'),
          durationSeconds: 600,
          distanceMeters: 4_000
        }
      ])
    })

    it('omits laps and calories when the FIT file has none', async () => {
      mockFitOutput({
        sessions: [{ start_time: '2026-01-03T06:00:00Z' }],
        records: [
          {
            position_lat: 37.78,
            position_long: -122.42,
            timestamp: '2026-01-03T06:00:00Z'
          }
        ],
        laps: []
      })

      const parsed = await parseFitnessFile({
        fileType: 'fit',
        buffer: Buffer.from('binary-fit-content')
      })

      expect(parsed).not.toHaveProperty('laps')
      expect(parsed).not.toHaveProperty('calories')
    })

    it('reads TCX cadence, distance, laps and summed calories', async () => {
      const tcx = `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns:ns3="http://www.garmin.com/xmlschemas/ActivityExtension/v2">
  <Activities>
    <Activity Sport="Biking">
      <Id>2026-01-02T07:00:00Z</Id>
      <Lap StartTime="2026-01-02T07:00:00Z">
        <TotalTimeSeconds>600</TotalTimeSeconds>
        <DistanceMeters>3000</DistanceMeters>
        <Calories>90</Calories>
        <AverageHeartRateBpm><Value>130</Value></AverageHeartRateBpm>
        <MaximumHeartRateBpm><Value>150</Value></MaximumHeartRateBpm>
        <Cadence>84</Cadence>
        <Extensions>
          <ns3:LX>
            <ns3:AvgSpeed>5</ns3:AvgSpeed>
            <ns3:AvgWatts>180</ns3:AvgWatts>
          </ns3:LX>
        </Extensions>
        <Track>
          <Trackpoint>
            <Time>2026-01-02T07:00:00Z</Time>
            <Position><LatitudeDegrees>37.78</LatitudeDegrees><LongitudeDegrees>-122.41</LongitudeDegrees></Position>
            <DistanceMeters>0</DistanceMeters>
            <Cadence>80</Cadence>
          </Trackpoint>
          <Trackpoint>
            <Time>2026-01-02T07:00:10Z</Time>
            <Position><LatitudeDegrees>37.79</LatitudeDegrees><LongitudeDegrees>-122.4</LongitudeDegrees></Position>
            <DistanceMeters>52.5</DistanceMeters>
            <Extensions><ns3:TPX><ns3:RunCadence>90</ns3:RunCadence></ns3:TPX></Extensions>
          </Trackpoint>
        </Track>
      </Lap>
      <Lap StartTime="2026-01-02T07:10:00Z">
        <TotalTimeSeconds>300</TotalTimeSeconds>
        <DistanceMeters>1500</DistanceMeters>
        <Calories>40</Calories>
        <Extensions/>
      </Lap>
    </Activity>
  </Activities>
</TrainingCenterDatabase>`

      const parsed = await parseFitnessFile({
        fileType: 'tcx',
        buffer: Buffer.from(tcx)
      })

      expect(parsed.calories).toBe(130)
      expect(parsed.trackPoints.map((point) => point.cadence)).toEqual([80, 90])
      expect(parsed.trackPoints.map((point) => point.distanceMeters)).toEqual([
        0, 52.5
      ])
      expect(parsed.laps).toEqual([
        {
          startElapsedSeconds: 0,
          startTimestamp: Date.parse('2026-01-02T07:00:00Z'),
          durationSeconds: 600,
          distanceMeters: 3_000,
          avgPower: 180,
          avgHeartRate: 130,
          maxHeartRate: 150,
          avgCadence: 84,
          avgSpeed: 18,
          calories: 90
        },
        {
          startElapsedSeconds: 600,
          startTimestamp: Date.parse('2026-01-02T07:10:00Z'),
          durationSeconds: 300,
          distanceMeters: 1_500,
          calories: 40
        }
      ])
    })

    it('keeps metric points for FIT records without GPS positions', async () => {
      mockFitOutput({
        sessions: [{ start_time: '2026-01-04T08:00:00Z' }],
        records: [
          {
            timestamp: '2026-01-04T08:00:00Z',
            power: 180,
            heart_rate: 135,
            cadence: 80,
            speed: 30,
            distance: 0,
            temperature: 24,
            left_right_balance: { value: 51, right: true }
          },
          { timestamp: '2026-01-04T08:00:05Z', power: 200 },
          // nothing chartable on this record
          { timestamp: '2026-01-04T08:00:10Z' }
        ]
      })

      const parsed = await parseFitnessFile({
        fileType: 'fit',
        buffer: Buffer.from('binary-fit-content')
      })

      expect(parsed.trackPoints).toHaveLength(0)
      expect(parsed.coordinates).toHaveLength(0)
      expect(parsed.metricPoints).toEqual([
        {
          timestamp: new Date('2026-01-04T08:00:00Z'),
          power: 180,
          heartRate: 135,
          cadence: 80,
          speed: 30,
          distanceMeters: 0,
          temperature: 24,
          leftRightBalance: 49
        },
        { timestamp: new Date('2026-01-04T08:00:05Z'), power: 200 }
      ])
    })

    it('keeps metric points for TCX trackpoints without positions', async () => {
      const tcx = `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns:ns3="http://www.garmin.com/xmlschemas/ActivityExtension/v2">
  <Activities>
    <Activity Sport="Biking">
      <Id>2026-01-04T08:00:00Z</Id>
      <Lap StartTime="2026-01-04T08:00:00Z">
        <TotalTimeSeconds>10</TotalTimeSeconds>
        <DistanceMeters>80</DistanceMeters>
        <Track>
          <Trackpoint>
            <Time>2026-01-04T08:00:00Z</Time>
            <DistanceMeters>0</DistanceMeters>
            <HeartRateBpm><Value>120</Value></HeartRateBpm>
            <Cadence>85</Cadence>
            <Extensions><ns3:TPX><ns3:Watts>190</ns3:Watts><ns3:Speed>8</ns3:Speed></ns3:TPX></Extensions>
          </Trackpoint>
          <Trackpoint>
            <Time>2026-01-04T08:00:10Z</Time>
            <DistanceMeters>80</DistanceMeters>
            <HeartRateBpm><Value>124</Value></HeartRateBpm>
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

      expect(parsed.trackPoints).toHaveLength(0)
      expect(parsed.metricPoints).toEqual([
        {
          timestamp: new Date('2026-01-04T08:00:00Z'),
          distanceMeters: 0,
          heartRate: 120,
          cadence: 85,
          power: 190,
          speed: 28.8
        },
        {
          timestamp: new Date('2026-01-04T08:00:10Z'),
          distanceMeters: 80,
          heartRate: 124
        }
      ])
    })

    it('reads GPX cadence, temperature and power extensions', async () => {
      const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="tests" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">
  <trk>
    <type>cycling</type>
    <trkseg>
      <trkpt lat="37.7749" lon="-122.4194">
        <time>2026-01-01T10:00:00Z</time>
        <extensions>
          <power>230</power>
          <gpxtpx:TrackPointExtension>
            <gpxtpx:hr>140</gpxtpx:hr>
            <gpxtpx:cad>91</gpxtpx:cad>
            <gpxtpx:atemp>19.5</gpxtpx:atemp>
          </gpxtpx:TrackPointExtension>
        </extensions>
      </trkpt>
      <trkpt lat="37.7759" lon="-122.4184">
        <time>2026-01-01T10:00:10Z</time>
      </trkpt>
    </trkseg>
  </trk>
</gpx>`

      const parsed = await parseFitnessFile({
        fileType: 'gpx',
        buffer: Buffer.from(gpx)
      })

      expect(parsed.trackPoints[0]).toMatchObject({
        heartRate: 140,
        cadence: 91,
        temperature: 19.5,
        power: 230
      })
      expect(parsed.trackPoints[1].cadence).toBeUndefined()
    })

    it('derives power stats from GPX power extensions', async () => {
      const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="tests">
  <trk>
    <trkseg>
      <trkpt lat="37.7749" lon="-122.4194">
        <time>2026-01-01T10:00:00Z</time>
        <extensions><power>200</power></extensions>
      </trkpt>
      <trkpt lat="37.7759" lon="-122.4184">
        <time>2026-01-01T10:00:10Z</time>
        <extensions>
          <gpxpx:PowerExtension xmlns:gpxpx="http://www.garmin.com/xmlschemas/PowerExtension/v1">
            <gpxpx:PowerInWatts>300</gpxpx:PowerInWatts>
          </gpxpx:PowerExtension>
        </extensions>
      </trkpt>
    </trkseg>
  </trk>
</gpx>`

      const parsed = await parseFitnessFile({
        fileType: 'gpx',
        buffer: Buffer.from(gpx)
      })

      expect(parsed.powerSeries).toEqual([200, 300])
      expect(parsed.avgPower).toBe(250)
      expect(parsed.maxPower).toBe(300)
    })

    it('reads GPX track point extensions bound to another prefix', async () => {
      const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="tests">
  <trk>
    <trkseg>
      <trkpt lat="37.7749" lon="-122.4194">
        <time>2026-01-01T10:00:00Z</time>
        <extensions>
          <ns3:TrackPointExtension xmlns:ns3="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">
            <ns3:hr>150</ns3:hr>
            <ns3:cad>77</ns3:cad>
            <ns3:atemp>12</ns3:atemp>
          </ns3:TrackPointExtension>
        </extensions>
      </trkpt>
    </trkseg>
  </trk>
</gpx>`

      const parsed = await parseFitnessFile({
        fileType: 'gpx',
        buffer: Buffer.from(gpx)
      })

      expect(parsed.trackPoints[0]).toMatchObject({
        heartRate: 150,
        cadence: 77,
        temperature: 12
      })
    })

    it.each([
      [
        'ns2:',
        'xmlns:ns2="http://www.garmin.com/xmlschemas/ActivityExtension/v2"'
      ],
      ['', 'xmlns="http://www.garmin.com/xmlschemas/ActivityExtension/v2"']
    ])('reads TCX extensions with prefix "%s"', async (prefix, namespace) => {
      const tcx = `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase>
  <Activities>
    <Activity Sport="Biking">
      <Id>2026-01-02T07:00:00Z</Id>
      <Lap StartTime="2026-01-02T07:00:00Z">
        <TotalTimeSeconds>10</TotalTimeSeconds>
        <DistanceMeters>80</DistanceMeters>
        <Extensions>
          <${prefix}LX ${namespace}>
            <${prefix}AvgWatts>210</${prefix}AvgWatts>
            <${prefix}AvgSpeed>10</${prefix}AvgSpeed>
          </${prefix}LX>
        </Extensions>
        <Track>
          <Trackpoint>
            <Time>2026-01-02T07:00:00Z</Time>
            <Position><LatitudeDegrees>37.78</LatitudeDegrees><LongitudeDegrees>-122.41</LongitudeDegrees></Position>
            <Extensions>
              <${prefix}TPX ${namespace}>
                <${prefix}Watts>250</${prefix}Watts>
                <${prefix}RunCadence>88</${prefix}RunCadence>
              </${prefix}TPX>
            </Extensions>
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

      expect(parsed.trackPoints[0]).toMatchObject({
        power: 250,
        cadence: 88
      })
      expect(parsed.laps?.[0]).toMatchObject({ avgPower: 210, avgSpeed: 36 })
    })

    it('still parses a TCX trackpoint whose Cadence has child elements', async () => {
      const tcx = `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase>
  <Activities>
    <Activity Sport="Biking">
      <Id>2026-01-02T07:00:00Z</Id>
      <Lap StartTime="2026-01-02T07:00:00Z">
        <TotalTimeSeconds>10</TotalTimeSeconds>
        <DistanceMeters>80</DistanceMeters>
        <Calories><Value>5</Value></Calories>
        <Track>
          <Trackpoint>
            <Time>2026-01-02T07:00:00Z</Time>
            <Position><LatitudeDegrees>37.78</LatitudeDegrees><LongitudeDegrees>-122.41</LongitudeDegrees></Position>
            <Cadence><Value>1</Value></Cadence>
            <DistanceMeters><Value>2</Value></DistanceMeters>
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

      expect(parsed.coordinates).toHaveLength(1)
      expect(parsed.trackPoints[0].cadence).toBeUndefined()
      expect(parsed.trackPoints[0].distanceMeters).toBeUndefined()
      expect(parsed.calories).toBeUndefined()
    })

    it('only builds metric points for files without a GPS track', async () => {
      mockFitOutput({
        sessions: [{ start_time: '2026-01-03T06:00:00Z' }],
        records: [
          {
            position_lat: 37.78,
            position_long: -122.42,
            timestamp: '2026-01-03T06:00:00Z',
            power: 200
          }
        ]
      })

      const parsed = await parseFitnessFile({
        fileType: 'fit',
        buffer: Buffer.from('binary-fit-content')
      })

      expect(parsed.trackPoints).toHaveLength(1)
      expect(parsed).not.toHaveProperty('metricPoints')
    })
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
