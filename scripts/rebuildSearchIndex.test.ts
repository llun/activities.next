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
})
