import { parseArgs, planDeviceBackfill } from './backfillFitnessDevices'

describe('backfillFitnessDevices parseArgs', () => {
  it('requires an actor id', () => {
    expect(() => parseArgs([])).toThrow()
  })

  it('writes nothing unless --apply is given', () => {
    expect(parseArgs(['--actor-id', 'actor-1'])).toEqual({
      actorId: 'actor-1',
      apply: false
    })
  })

  it('accepts bare, inline, and space-separated forms of --apply', () => {
    expect(parseArgs(['--actor-id', 'actor-1', '--apply'])).toEqual({
      actorId: 'actor-1',
      apply: true
    })
    expect(parseArgs(['--actor-id', 'actor-1', '--apply=false'])).toEqual({
      actorId: 'actor-1',
      apply: false
    })
    expect(parseArgs(['--apply', 'true', '--actor-id', 'actor-1'])).toEqual({
      actorId: 'actor-1',
      apply: true
    })
  })

  it('rejects an invalid boolean value', () => {
    expect(() =>
      parseArgs(['--actor-id', 'actor-1', '--apply', 'maybe'])
    ).toThrow('Invalid boolean value: maybe. Use true or false.')
  })

  it('rejects an unexpected positional argument', () => {
    expect(() => parseArgs(['actor-1'])).toThrow('Unexpected argument: actor-1')
  })
})

describe('planDeviceBackfill', () => {
  it('collapses every spelling of one device onto a single group', () => {
    // Case and spacing are the two ways the same head unit spells its name
    // across FIT, TCX and Strava; resolving it once is the whole point of
    // grouping before writing.
    const groups = planDeviceBackfill([
      {
        id: 'file-1',
        deviceName: 'Garmin Edge 840',
        deviceManufacturer: 'garmin'
      },
      { id: 'file-2', deviceName: 'garmin  edge 840' },
      { id: 'file-3', deviceName: '  Garmin Edge 840  ' }
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({
      deviceKey: 'name:garmin edge 840',
      // The first spelling seen is what the created row is named from.
      deviceName: 'Garmin Edge 840',
      deviceManufacturer: 'garmin',
      fileIds: ['file-1', 'file-2', 'file-3']
    })
  })

  it('keeps distinct devices apart', () => {
    const groups = planDeviceBackfill([
      { id: 'file-1', deviceName: 'Garmin Edge 840' },
      { id: 'file-2', deviceName: 'Wahoo ELEMNT BOLT' },
      { id: 'file-3', deviceManufacturer: 'coros' }
    ])

    expect(groups.map((group) => group.deviceKey)).toEqual([
      'name:garmin edge 840',
      'name:wahoo elemnt bolt',
      'mfr:coros'
    ])
  })

  it('excludes files with no device identity to key on', () => {
    const groups = planDeviceBackfill([
      { id: 'file-1' },
      { id: 'file-2', deviceName: '   ' },
      // A raw FIT code nothing recognises is not an identity worth a page.
      { id: 'file-3', deviceName: '4315', deviceManufacturer: '65535' }
    ])

    expect(groups).toEqual([])
  })

  it('excludes files that are already linked', () => {
    // This is what makes a re-run cheap and keeps a manual correction intact.
    const groups = planDeviceBackfill([
      {
        id: 'file-1',
        deviceName: 'Garmin Edge 840',
        deviceGearId: 'device-1'
      },
      { id: 'file-2', deviceName: 'Garmin Edge 840' }
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0].fileIds).toEqual(['file-2'])
  })

  it('returns nothing for an empty history', () => {
    expect(planDeviceBackfill([])).toEqual([])
  })
})
