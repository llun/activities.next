import { parseArgs } from './importFitnessGear'

describe('importFitnessGear parseArgs', () => {
  it('requires an actor id and an input path', () => {
    expect(() => parseArgs([])).toThrow()
    expect(() => parseArgs(['--actor-id', 'actor-1'])).toThrow()
    expect(() => parseArgs(['--input', 'gear.json'])).toThrow()
  })

  it('defaults tolerance, overwrite and dry-run', () => {
    expect(
      parseArgs(['--actor-id', 'actor-1', '--input', 'gear.json'])
    ).toEqual({
      actorId: 'actor-1',
      input: 'gear.json',
      toleranceSeconds: 60,
      overwrite: false,
      dryRun: false
    })
  })

  it('accepts bare, inline, and space-separated boolean flags', () => {
    expect(
      parseArgs([
        '--actor-id',
        'actor-1',
        '--input',
        'gear.json',
        '--overwrite',
        '--dry-run'
      ])
    ).toMatchObject({ overwrite: true, dryRun: true })
    expect(
      parseArgs([
        '--actor-id=actor-1',
        '--input=gear.json',
        '--dry-run=false',
        '--overwrite=true'
      ])
    ).toMatchObject({ overwrite: true, dryRun: false })
    expect(
      parseArgs(['--dry-run', '--actor-id', 'actor-1', '--input', 'gear.json'])
    ).toMatchObject({ overwrite: false, dryRun: true })
  })

  it('reads the tolerance as a number', () => {
    expect(
      parseArgs([
        '--actor-id',
        'actor-1',
        '--input',
        'gear.json',
        '--tolerance-seconds',
        '5'
      ])
    ).toMatchObject({ toleranceSeconds: 5 })
  })

  it.each([
    { description: 'a non-numeric tolerance', value: 'abc' },
    { description: 'a zero tolerance', value: '0' },
    { description: 'a tolerance beyond an hour', value: '3601' }
  ])('rejects $description', ({ value }) => {
    expect(() =>
      parseArgs([
        '--actor-id',
        'actor-1',
        '--input',
        'gear.json',
        '--tolerance-seconds',
        value
      ])
    ).toThrow()
  })

  it('rejects invalid boolean values', () => {
    expect(() =>
      parseArgs([
        '--actor-id',
        'actor-1',
        '--input',
        'gear.json',
        '--dry-run',
        'maybe'
      ])
    ).toThrow('Invalid boolean value: maybe. Use true or false.')
  })
})
