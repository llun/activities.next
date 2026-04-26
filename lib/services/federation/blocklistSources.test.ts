import {
  fetchKnownDomainBlocklist,
  parseCsvLine,
  parseCsvRecords,
  parseDomainBlockCsv
} from './blocklistSources'

describe('blocklistSources', () => {
  it('parses quoted CSV fields', () => {
    expect(parseCsvLine('a,"b, c","d ""quoted"""')).toEqual([
      'a',
      'b, c',
      'd "quoted"'
    ])
  })

  it('parses quoted CSV fields with newlines', () => {
    expect(parseCsvRecords('a,b\none,"two\nlines"\nthree,four')).toEqual([
      ['a', 'b'],
      ['one', 'two\nlines'],
      ['three', 'four']
    ])
  })

  it('parses Mastodon-compatible domain block CSV rows', () => {
    const blocks = parseDomainBlockCsv(
      [
        '#Domain,Severity,Reject_Media,Reject_Reports,Public_Comment,Obfuscate',
        'Example.Social,suspend,True,False,"spam, abuse",False',
        'example.social,silence,False,False,duplicate,False',
        'bad.test,noop,False,True,,True'
      ].join('\n'),
      'test-source'
    )

    expect(blocks).toEqual([
      {
        domain: 'example.social',
        severity: 'silence',
        rejectMedia: false,
        rejectReports: false,
        publicComment: 'duplicate',
        privateComment: null,
        obfuscate: false,
        source: 'test-source'
      },
      {
        domain: 'bad.test',
        severity: 'noop',
        rejectMedia: false,
        rejectReports: true,
        publicComment: null,
        privateComment: null,
        obfuscate: true,
        source: 'test-source'
      }
    ])
  })

  it('fetches a known source and parses the response', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      text: async () =>
        'domain,severity,reject_media,reject_reports,public_comment,obfuscate\nbad.test,suspend,False,False,spam,False'
    })

    const blocks = await fetchKnownDomainBlocklist(
      'oliphant-tier0',
      fetchImpl as unknown as typeof fetch
    )

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://codeberg.org/oliphant/blocklists/raw/branch/main/blocklists/_unified_tier0_blocklist.csv'
    )
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({
      domain: 'bad.test',
      severity: 'suspend',
      source: 'oliphant-tier0'
    })
  })
})
