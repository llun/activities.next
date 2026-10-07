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

  describe('when the actor host does not confirm', () => {
    const actorId = 'https://ap.remote.test/users/1234'

    // FEP-2c59: the actor names its handle, and only that domain knows it.
    it('confirms through the domain the webfinger property names', async () => {
      serveWebfinger({ 'alice@handle.test': { self: actorId } })

      await expect(
        confirmActorHandle({
          database,
          actorId,
          username: 'alice',
          webfinger: 'alice@handle.test'
        })
      ).resolves.toEqual({ username: 'alice', domain: 'handle.test' })
      expect(askedAccounts()).toEqual([
        'acct:alice@ap.remote.test',
        'acct:alice@handle.test'
      ])
    })

    // Mastodon's `subject` redirect: the actor host knows the actor but not
    // under its own name, and points at the handle's domain.
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
    })

    // The confirmed handle is what gets stored, never `preferredUsername` on
    // the actor host, so it must be the handle domain's own answer.
    it('returns the handle domain subject, not the requested username', async () => {
      serveWebfinger({
        'alice@handle.test': {
          self: actorId,
          subject: 'acct:ALICE@handle.test'
        }
      })

      await expect(
        confirmActorHandle({
          database,
          actorId,
          username: 'admin',
          webfinger: 'alice@handle.test'
        })
      ).resolves.toEqual({ username: 'ALICE', domain: 'handle.test' })
    })

    it('refuses when the handle domain names another actor', async () => {
      serveWebfinger({
        'alice@handle.test': { self: 'https://ap.remote.test/users/9999' }
      })

      await expect(
        confirmActorHandle({
          database,
          actorId,
          username: 'alice',
          webfinger: 'alice@handle.test'
        })
      ).resolves.toBeNull()
    })

    // One hop only, like Mastodon: a second, different subject is a chain.
    it('refuses when the handle domain answers with yet another handle', async () => {
      serveWebfinger({
        'alice@handle.test': {
          self: actorId,
          subject: 'acct:alice@third.test'
        }
      })

      await expect(
        confirmActorHandle({
          database,
          actorId,
          username: 'alice',
          webfinger: 'alice@handle.test'
        })
      ).resolves.toBeNull()
      expect(askedAccounts()).toHaveLength(2)
    })

    it('does not ask a blocked handle domain', async () => {
      await database.createDomainBlock({ domain: 'blocked.test' })
      serveWebfinger({ 'alice@blocked.test': { self: actorId } })

      await expect(
        confirmActorHandle({
          database,
          actorId,
          username: 'alice',
          webfinger: 'alice@blocked.test'
        })
      ).resolves.toBeNull()
      expect(askedAccounts()).toEqual(['acct:alice@ap.remote.test'])
    })

    it.each([
      'alice',
      'alice@handle.test@x.test',
      'ali/ce@handle.test',
      'alice@handle.test/path',
      'alice@user:pass@handle.test',
      '@handle.test'
    ])('ignores a malformed webfinger property (%s)', async (webfinger) => {
      serveWebfinger({})

      await expect(
        confirmActorHandle({
          database,
          actorId,
          username: 'alice',
          webfinger
        })
      ).resolves.toBeNull()
      expect(askedAccounts()).toEqual(['acct:alice@ap.remote.test'])
    })
  })
})
