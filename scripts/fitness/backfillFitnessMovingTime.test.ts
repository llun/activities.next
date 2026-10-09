import { parseArgs as parseMovingTimeArgs } from './backfillFitnessMovingTime'
import { parseArgs as parseSummaryMetricsArgs } from './backfillFitnessSummaryMetrics'

// Each backfill script owns its own copy of `parseArgs`, so both are held to
// the same contract here.
describe.each([
  { script: 'backfillFitnessMovingTime', parseArgs: parseMovingTimeArgs },
  {
    script: 'backfillFitnessSummaryMetrics',
    parseArgs: parseSummaryMetricsArgs
  }
])('$script parseArgs', ({ parseArgs }) => {
  it('requires an actor id', () => {
    expect(() => parseArgs([])).toThrow()
  })

  it('defaults force and dry-run to false', () => {
    expect(parseArgs(['--actor-id', 'actor-1'])).toEqual({
      actorId: 'actor-1',
      force: false,
      dryRun: false
    })
  })

  it('accepts bare, inline, and space-separated boolean flags', () => {
    expect(
      parseArgs(['--actor-id', 'actor-1', '--force', '--dry-run'])
    ).toEqual({ actorId: 'actor-1', force: true, dryRun: true })
    expect(
      parseArgs(['--actor-id', 'actor-1', '--dry-run=false', '--force=true'])
    ).toEqual({ actorId: 'actor-1', force: true, dryRun: false })
    expect(parseArgs(['--dry-run', '--actor-id', 'actor-1'])).toEqual({
      actorId: 'actor-1',
      force: false,
      dryRun: true
    })
  })

  it('rejects invalid boolean values', () => {
    expect(() =>
      parseArgs(['--actor-id', 'actor-1', '--dry-run', 'maybe'])
    ).toThrow('Invalid boolean value: maybe. Use true or false.')
  })
})
