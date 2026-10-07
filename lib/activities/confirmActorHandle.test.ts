import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { JRD_JSON_HEADERS } from '@/lib/stub/activities'
import { MockWebfinger } from '@/lib/stub/webfinger'

import { confirmActorHandle } from './confirmActorHandle'

enableFetchMocks()

type ServedAccount = {
  self: string
  // The handle the host answers with, when it is not the one asked for (a
  // split-domain host names the handle's real domain here).
  subject?: string
}

// Answers WebFinger for each `account` on the host its domain names, and 404s
// everything else, so a lookup on the wrong host or for the wrong handle fails.
const serveWebfinger = (accounts: Record<string, ServedAccount>) => {
  fetchMock.resetMocks()
  fetchMock.mockResponse(async (req) => {
    const url = new URL(req.url)
    const account = url.searchParams.get('resource')?.replace(/^acct:/, '')
    const served = account ? accounts[account] : undefined
    if (
      url.pathname !== '/.well-known/webfinger' ||
      !account ||
      !served ||
      url.host !== account.split('@')[1]
    ) {
      return { status: 404, body: 'Not Found' }
    }
    const document = MockWebfinger({ account, userUrl: served.self })
    return {
      status: 200,
      headers: JRD_JSON_HEADERS,
      body: JSON.stringify({
        ...document,
        subject: served.subject ?? document.subject
      })
    }
  })
}

const askedAccounts = () =>
  fetchMock.mock.calls.map(([input]) =>
    new URL(String(input)).searchParams.get('resource')
  )

describe('confirmActorHandle', () => {
  const database = getTestSQLDatabase()

  beforeAll(async () => {
    await database.migrate()
  })

  afterAll(async () => {
    await database.destroy()
  })

  // The row stores `new URL(id).host`, port included, so the lookup must go
  // to that same host:port and name it in the account.
  it('asks the actor host with its port', async () => {
    const actorId = 'https://remote.test:8443/users/alice'
    serveWebfinger({ 'alice@remote.test:8443': { self: actorId } })

    await expect(
      confirmActorHandle({ database, actorId, username: 'alice' })
    ).resolves.toEqual({ username: 'alice', domain: 'remote.test:8443' })
  })

  // URL serialization noise (host case, a default port) is not a different
  // actor.
  it('matches a self link that differs only in host case', async () => {
    const actorId = 'https://remote.test/users/alice'
    serveWebfinger({
      'alice@remote.test': { self: 'https://REMOTE.test/users/alice' }
    })

    await expect(
      confirmActorHandle({ database, actorId, username: 'alice' })
    ).resolves.toEqual({ username: 'alice', domain: 'remote.test' })
  })

  // A split-domain host answers for `user@<actor host>` with the handle's
  // domain as subject. The actor host vouched, so the row keeps that host and
  // the subject's domain is never asked.
  it('keeps the actor host when it confirms under another subject', async () => {
    const actorId = 'https://social.remote.test/users/alice'
    serveWebfinger({
      'alice@social.remote.test': {
        self: actorId,
        subject: 'acct:alice@remote.test'
      }
    })

    await expect(
      confirmActorHandle({ database, actorId, username: 'alice' })
    ).resolves.toEqual({ username: 'alice', domain: 'social.remote.test' })
    expect(askedAccounts()).toEqual(['acct:alice@social.remote.test'])
  })

  it('refuses a self link naming another actor', async () => {
    serveWebfinger({
      'alice@remote.test': { self: 'https://remote.test/users/mallory' }
    })

    await expect(
      confirmActorHandle({
        database,
        actorId: 'https://remote.test/users/alice',
        username: 'alice'
      })
    ).resolves.toBeNull()
  })

  it.each(['not a url', 'urn:uuid:1234', ''])(
    'refuses an actor id with no host (%s) without fetching',
    async (actorId) => {
      fetchMock.resetMocks()

      await expect(
        confirmActorHandle({ database, actorId, username: 'alice' })
      ).resolves.toBeNull()
      expect(fetchMock).not.toHaveBeenCalled()
    }
  )

  describe('when the actor host redirects with its subject', () => {
    const actorId = 'https://ap.remote.test/users/1234'

    // Mastodon's `subject` redirect: the actor host knows the handle but
    // names it on another domain, and only that domain names this actor.
    it('confirms through the subject the actor host answers with', async () => {
      serveWebfinger({
        'alice@ap.remote.test': {
          self: 'https://ap.remote.test/users/other',
          subject: 'acct:Alice@handle.test'
        },
        'Alice@handle.test': { self: actorId }
      })

      await expect(
        confirmActorHandle({ database, actorId, username: 'alice' })
      ).resolves.toEqual({ username: 'Alice', domain: 'handle.test' })
      expect(askedAccounts()).toEqual([
        'acct:alice@ap.remote.test',
        'acct:Alice@handle.test'
      ])
    })

    // The confirmed handle is what gets stored, so it is the handle domain's
    // own answer, not the casing the redirect used.
    it('returns the handle domain subject', async () => {
      serveWebfinger({
        'alice@ap.remote.test': {
          self: 'https://ap.remote.test/users/other',
          subject: 'acct:alice@handle.test'
        },
        'alice@handle.test': {
          self: actorId,
          subject: 'acct:ALICE@handle.test'
        }
      })

      await expect(
        confirmActorHandle({ database, actorId, username: 'alice' })
      ).resolves.toEqual({ username: 'ALICE', domain: 'handle.test' })
    })

    it('refuses when the handle domain names another actor', async () => {
      serveWebfinger({
        'alice@ap.remote.test': {
          self: 'https://ap.remote.test/users/other',
          subject: 'acct:alice@handle.test'
        },
        'alice@handle.test': { self: 'https://ap.remote.test/users/9999' }
      })

      await expect(
        confirmActorHandle({ database, actorId, username: 'alice' })
      ).resolves.toBeNull()
    })

    // One hop only, like Mastodon: a second, different subject is a chain.
    it('refuses when the handle domain answers with yet another handle', async () => {
      serveWebfinger({
        'alice@ap.remote.test': {
          self: 'https://ap.remote.test/users/other',
          subject: 'acct:alice@handle.test'
        },
        'alice@handle.test': {
          self: actorId,
          subject: 'acct:alice@third.test'
        }
      })

      await expect(
        confirmActorHandle({ database, actorId, username: 'alice' })
      ).resolves.toBeNull()
      expect(askedAccounts()).toHaveLength(2)
    })

    it('does not ask a blocked handle domain', async () => {
      await database.createDomainBlock({ domain: 'blocked.test' })
      serveWebfinger({
        'alice@ap.remote.test': {
          self: 'https://ap.remote.test/users/other',
          subject: 'acct:alice@blocked.test'
        },
        'alice@blocked.test': { self: actorId }
      })

      await expect(
        confirmActorHandle({ database, actorId, username: 'alice' })
      ).resolves.toBeNull()
      expect(askedAccounts()).toEqual(['acct:alice@ap.remote.test'])
    })

    it.each([
      'acct:alice',
      'acct:alice@handle.test@x.test',
      'acct:ali/ce@handle.test',
      'acct:alice@handle.test/path',
      'acct:alice@user:pass@handle.test',
      'acct:@handle.test',
      'https://handle.test/users/alice'
    ])('ignores a malformed subject (%s)', async (subject) => {
      serveWebfinger({
        'alice@ap.remote.test': {
          self: 'https://ap.remote.test/users/other',
          subject
        }
      })

      await expect(
        confirmActorHandle({ database, actorId, username: 'alice' })
      ).resolves.toBeNull()
      expect(askedAccounts()).toEqual(['acct:alice@ap.remote.test'])
    })
  })
})
