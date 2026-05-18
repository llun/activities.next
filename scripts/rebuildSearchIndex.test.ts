import { parseArgs } from './rebuildSearchIndex'

describe('rebuildSearchIndex parseArgs', () => {
  it('parses explicit false boolean flags', () => {
    expect(
      parseArgs([
        '--backend',
        'database',
        '--clear=false',
        '--dry-run',
        'false'
      ])
    ).toEqual({
      backend: 'database',
      clear: false,
      batchSize: 500,
      dryRun: false
    })
  })

  it('parses bare boolean flags as true', () => {
    expect(parseArgs(['--clear', '--dry-run'])).toMatchObject({
      clear: true,
      dryRun: true
    })
  })

  it('parses equals-form string options', () => {
    expect(parseArgs(['--backend=all', '--batch-size=1000'])).toMatchObject({
      backend: 'all',
      batchSize: 1000
    })
  })

  it('rejects unknown flags and positionals', () => {
    expect(() => parseArgs(['--unknown', 'value'])).toThrow()
    expect(() => parseArgs(['unexpected'])).toThrow()
  })

  it('rejects invalid explicit boolean values', () => {
    expect(() => parseArgs(['--clear=maybe'])).toThrow(
      'Invalid value for --clear'
    )
  })
})
