import {
  KNOWN_DOMAIN_BLOCKLIST_MAX_BYTES,
  KNOWN_DOMAIN_BLOCKLIST_TIMEOUT_MS,
  downloadKnownDomainBlocklist,
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

  it('keeps quotes literal when they do not start a field', () => {
    expect(parseCsvLine('bad.test,spam "quote" marker')).toEqual([
      'bad.test',
      'spam "quote" marker'
    ])
  })

  it('parses quoted CSV fields with newlines', () => {
    expect(parseCsvRecords('a,b\none,"two\nlines"\nthree,four')).toEqual([
      ['a', 'b'],
      ['one', 'two\nlines'],
      ['three', 'four']
    ])
  })

  it('allows records with different column counts', () => {
    expect(
      parseCsvRecords('domain,severity\nbad.test\nworse.test,suspend')
    ).toEqual([['domain', 'severity'], ['bad.test'], ['worse.test', 'suspend']])
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
    const requestImpl = vi.fn().mockResolvedValue({
      statusCode: 200,
      headers: {},
      body: 'domain,severity,reject_media,reject_reports,public_comment,obfuscate\nbad.test,suspend,False,False,spam,False'
    })

    const blocks = await downloadKnownDomainBlocklist(
      'oliphant-tier0',
      requestImpl
    )

    expect(requestImpl).toHaveBeenCalledWith({
      url: 'https://codeberg.org/oliphant/blocklists/raw/branch/main/blocklists/_unified_tier0_blocklist.csv',
      responseTimeout: KNOWN_DOMAIN_BLOCKLIST_TIMEOUT_MS,
      numberOfRetry: 0,
      maxResponseSize: KNOWN_DOMAIN_BLOCKLIST_MAX_BYTES
    })
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({
      domain: 'bad.test',
      severity: 'suspend',
      source: 'oliphant-tier0'
    })
  })

  it('includes response error details when downloading a known source fails', async () => {
    const requestImpl = vi.fn().mockResolvedValue({
      statusCode: 500,
      headers: {},
      body: '{"message":"upstream unavailable"}'
    })

    await expect(
      downloadKnownDomainBlocklist('oliphant-tier0', requestImpl)
    ).rejects.toThrow(
      'Failed to download Oliphant unified tier 0: upstream unavailable'
    )
  })

  it('rejects oversized known source responses by content length', async () => {
    const requestImpl = vi.fn().mockResolvedValue({
      statusCode: 200,
      headers: {
        'content-length': String(KNOWN_DOMAIN_BLOCKLIST_MAX_BYTES + 1)
      },
      body: ''
    })

    await expect(
      downloadKnownDomainBlocklist('oliphant-tier0', requestImpl)
    ).rejects.toThrow('Blocklist response too large')
  })

  it('rejects oversized known source response bodies', async () => {
    const requestImpl = vi.fn().mockResolvedValue({
      statusCode: 200,
      headers: {},
      body: 'a'.repeat(KNOWN_DOMAIN_BLOCKLIST_MAX_BYTES + 1)
    })

    await expect(
      downloadKnownDomainBlocklist('oliphant-tier0', requestImpl)
    ).rejects.toThrow('Blocklist response too large')
  })
})
