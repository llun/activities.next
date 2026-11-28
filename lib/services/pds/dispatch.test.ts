import {
  PDS_XRPC_DISPATCH,
  PDS_XRPC_PROXY_NSID_PREFIXES,
  type PdsXrpcCategory,
  type PdsXrpcHttpMethod,
  getPdsXrpcDispatchEntry,
  isPdsXrpcCategoryEnabled
} from './dispatch'

const PUBLIC_READ_NSIDS = [
  'com.atproto.server.describeServer',
  'com.atproto.repo.describeRepo',
  'com.atproto.repo.getRecord',
  'com.atproto.repo.listRecords',
  'com.atproto.sync.getRepo',
  'com.atproto.sync.getRecord',
  'com.atproto.sync.getBlocks',
  'com.atproto.sync.getLatestCommit',
  'com.atproto.sync.getRepoStatus',
  'com.atproto.sync.listRepos',
  'com.atproto.sync.listBlobs',
  'com.atproto.sync.getBlob'
]

const PENDING_METHODS: Array<[PdsXrpcHttpMethod, string, PdsXrpcCategory]> = [
  ['POST', 'com.atproto.server.createSession', 'session'],
  ['POST', 'com.atproto.server.refreshSession', 'session'],
  ['GET', 'com.atproto.server.getSession', 'session'],
  ['POST', 'com.atproto.server.deleteSession', 'session'],
  ['GET', 'com.atproto.server.getServiceAuth', 'session'],
  ['GET', 'com.atproto.server.checkAccountStatus', 'session'],
  ['GET', 'com.atproto.server.listAppPasswords', 'session'],
  ['POST', 'com.atproto.server.revokeAppPassword', 'session'],
  ['GET', 'com.atproto.identity.resolveHandle', 'authed-read'],
  ['GET', 'app.bsky.actor.getPreferences', 'authed-read'],
  ['POST', 'com.atproto.repo.createRecord', 'write'],
  ['POST', 'com.atproto.repo.putRecord', 'write'],
  ['POST', 'com.atproto.repo.deleteRecord', 'write'],
  ['POST', 'com.atproto.repo.applyWrites', 'write'],
  ['POST', 'com.atproto.repo.uploadBlob', 'write'],
  ['POST', 'app.bsky.actor.putPreferences', 'write']
]

describe('PDS XRPC dispatch table', () => {
  it('resolves every public read to public-read with a handler', () => {
    for (const nsid of PUBLIC_READ_NSIDS) {
      const entry = getPdsXrpcDispatchEntry('GET', nsid)
      expect(entry?.category).toBe('public-read')
      expect(entry?.handler).not.toBeNull()
    }
  })

  it('resolves every listed non-public method to its category without a handler', () => {
    for (const [method, nsid, category] of PENDING_METHODS) {
      const entry = getPdsXrpcDispatchEntry(method, nsid)
      expect(entry?.method).toBe(method)
      expect(entry?.category).toBe(category)
      expect(entry?.handler).toBeNull()
    }
  })

  it('has no duplicate method and NSID entries', () => {
    const keys = PDS_XRPC_DISPATCH.map(
      (entry) => `${entry.method} ${entry.nsid}`
    )
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('answers null for an unknown method', () => {
    expect(
      getPdsXrpcDispatchEntry('GET', 'com.example.unknownMethod')
    ).toBeNull()
    expect(
      getPdsXrpcDispatchEntry('POST', 'com.example.unknownMethod')
    ).toBeNull()
  })

  it('answers null for a listed method on the other HTTP method', () => {
    expect(
      getPdsXrpcDispatchEntry('POST', 'com.atproto.server.describeServer')
    ).toBeNull()
    expect(
      getPdsXrpcDispatchEntry('GET', 'com.atproto.server.createSession')
    ).toBeNull()
  })

  it('answers null for a locally owned NSID on the other HTTP method instead of the proxy', () => {
    expect(
      getPdsXrpcDispatchEntry('POST', 'app.bsky.actor.getPreferences')
    ).toBeNull()
    expect(
      getPdsXrpcDispatchEntry('GET', 'app.bsky.actor.putPreferences')
    ).toBeNull()
  })

  it('routes app.bsky.* and chat.bsky.* to the generic proxy entry', () => {
    for (const prefix of PDS_XRPC_PROXY_NSID_PREFIXES) {
      for (const method of ['GET', 'POST'] as const) {
        const entry = getPdsXrpcDispatchEntry(
          method,
          `${prefix}feed.getTimeline`
        )
        expect(entry?.category).toBe('proxy')
        expect(entry?.handler).toBeNull()
      }
    }
  })

  it('prefers an exact entry over the proxy namespace', () => {
    expect(
      getPdsXrpcDispatchEntry('GET', 'app.bsky.actor.getPreferences')?.category
    ).toBe('authed-read')
    expect(
      getPdsXrpcDispatchEntry('POST', 'app.bsky.actor.putPreferences')?.category
    ).toBe('write')
  })

  it('enables public reads always and other categories only with clientSignIn', () => {
    const publicRead = getPdsXrpcDispatchEntry(
      'GET',
      'com.atproto.server.describeServer'
    )!
    const session = getPdsXrpcDispatchEntry(
      'POST',
      'com.atproto.server.createSession'
    )!

    expect(isPdsXrpcCategoryEnabled(publicRead, { clientSignIn: false })).toBe(
      true
    )
    expect(isPdsXrpcCategoryEnabled(publicRead, { clientSignIn: true })).toBe(
      true
    )
    expect(isPdsXrpcCategoryEnabled(session, { clientSignIn: false })).toBe(
      false
    )
    expect(isPdsXrpcCategoryEnabled(session, { clientSignIn: true })).toBe(true)
  })
  it('answers null for a malformed NSID, even under a proxy prefix', () => {
    expect(getPdsXrpcDispatchEntry('GET', 'app.bsky.')).toBeNull()
    expect(getPdsXrpcDispatchEntry('POST', 'chat.bsky')).toBeNull()
  })
})
