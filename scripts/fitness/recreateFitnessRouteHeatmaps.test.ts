import { parseArgs } from './recreateFitnessRouteHeatmaps'

describe('recreateFitnessRouteHeatmaps parseArgs', () => {
  it('accepts bare, inline, and space-separated dry-run values', () => {
    expect(parseArgs(['--actor-id', 'actor-1', '--dry-run'])).toEqual({
      actorId: 'actor-1',
      dryRun: true
    })
    expect(parseArgs(['--actor-id', 'actor-1', '--dry-run=false'])).toEqual({
      actorId: 'actor-1',
      dryRun: false
    })
    expect(parseArgs(['--actor-id', 'actor-1', '--dry-run', 'false'])).toEqual({
      actorId: 'actor-1',
      dryRun: false
    })
  })

  it('leaves the next option available when dry-run has no value', () => {
    expect(parseArgs(['--dry-run', '--actor-id', 'actor-1'])).toEqual({
      actorId: 'actor-1',
      dryRun: true
    })
  })

  it('rejects invalid dry-run values with a targeted error', () => {
    expect(() =>
      parseArgs(['--actor-id', 'actor-1', '--dry-run', 'maybe'])
    ).toThrow('Invalid value for --dry-run: maybe. Use true or false.')
  })
})
