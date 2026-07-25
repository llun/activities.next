import { getConfig } from '@/lib/config'
import {
  databaseBeforeAll,
  getTestDatabaseTable
} from '@/lib/database/testUtils'
import { invalidateServerSettingsCache } from '@/lib/services/serverSettings'
import { TEST_DOMAIN } from '@/lib/stub/const'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'

import {
  REPLY_TOKEN_MAX_USES,
  REPLY_TOKEN_TTL_MS,
  createReplyToAddress,
  extractReplyTokenFromAddress,
  findReplyTokenInRecipients,
  hashReplyToken,
  mintReplyToken,
  resolveReplyToken
} from './replyToken'

const mockGetConfig = getConfig as jest.MockedFunction<typeof getConfig>
const ACTOR_ID = `https://${TEST_DOMAIN}/users/test1`
const STATUS_ID = `https://${TEST_DOMAIN}/users/test1/statuses/post-1`

const INBOUND = {
  secret: 'inbound-secret',
  domain: 'reply.llun.dev',
  localPartPrefix: 'reply'
}

describe('replyToken', () => {
  const table = getTestDatabaseTable()
  const baseConfig = mockGetConfig()

  beforeAll(async () => {
    await databaseBeforeAll(table)
    await Promise.all(table.map((item) => seedDatabase(item[1])))
  })

  afterAll(async () => {
    mockGetConfig.mockReturnValue(baseConfig)
    await Promise.all(table.map((item) => item[1].destroy()))
  })

  beforeEach(() => {
    mockGetConfig.mockReturnValue({
      ...baseConfig,
      emailInbound: INBOUND
    })
  })

  describe('hashReplyToken', () => {
    it('is deterministic and never returns the token itself', () => {
      const hash = hashReplyToken('some-token')
      expect(hash).toEqual(hashReplyToken('some-token'))
      expect(hash).toHaveLength(64)
      expect(hash).not.toContain('some-token')
    })

    it('produces a different hash for a different token', () => {
      expect(hashReplyToken('a')).not.toEqual(hashReplyToken('b'))
    })
  })

  describe('extractReplyTokenFromAddress', () => {
    it.each([
      {
        description: 'a bare reply address',
        address: 'reply+abc123@reply.llun.dev'
      },
      {
        description: 'an angle-addr with a display name',
        address: '"Replies" <reply+abc123@reply.llun.dev>'
      },
      {
        description: 'an upper-cased prefix and domain',
        address: 'REPLY+abc123@REPLY.LLUN.DEV'
      }
    ])('returns the token for $description', ({ address }) => {
      expect(extractReplyTokenFromAddress(address)).toBe('abc123')
    })

    it('preserves the token case', () => {
      expect(extractReplyTokenFromAddress('reply+AbC-_9@reply.llun.dev')).toBe(
        'AbC-_9'
      )
    })

    it.each([
      { description: 'another domain', address: 'reply+abc@example.tld' },
      { description: 'another prefix', address: 'inbox+abc@reply.llun.dev' },
      { description: 'no plus separator', address: 'reply@reply.llun.dev' },
      { description: 'an empty token', address: 'reply+@reply.llun.dev' },
      {
        description: 'a token outside the base64url alphabet',
        address: 'reply+abc$def@reply.llun.dev'
      },
      { description: 'a malformed address', address: 'not-an-address' }
    ])('returns null for $description', ({ address }) => {
      expect(extractReplyTokenFromAddress(address)).toBeNull()
    })

    it('returns null when inbound email is not configured', () => {
      mockGetConfig.mockReturnValue({ ...baseConfig, emailInbound: undefined })
      expect(
        extractReplyTokenFromAddress('reply+abc123@reply.llun.dev')
      ).toBeNull()
    })
  })

  describe('findReplyTokenInRecipients', () => {
    it('picks our address out of a recipient list', () => {
      expect(
        findReplyTokenInRecipients([
          'someone@example.tld',
          '"Replies" <reply+wanted@reply.llun.dev>',
          'other@example.tld'
        ])
      ).toBe('wanted')
    })

    it('returns null when no recipient is ours', () => {
      expect(
        findReplyTokenInRecipients(['a@example.tld', 'b@example.tld'])
      ).toBeNull()
    })
  })

  describe.each(table)('%s', (_, database) => {
    it('mints a token that resolves back to its row', async () => {
      const minted = await mintReplyToken(database, {
        actorId: ACTOR_ID,
        statusId: STATUS_ID,
        notificationType: 'mention'
      })

      expect(minted).not.toBeNull()
      expect(minted?.address).toBe(`reply+${minted?.token}@${INBOUND.domain}`)

      const resolved = await resolveReplyToken(database, minted!.token)
      expect(resolved).toMatchObject({
        status: 'ok',
        token: {
          actorId: ACTOR_ID,
          statusId: STATUS_ID,
          notificationType: 'mention'
        }
      })
    })

    it('stores only the hash, never the raw token', async () => {
      const minted = await mintReplyToken(database, {
        actorId: ACTOR_ID,
        statusId: STATUS_ID,
        notificationType: 'reply'
      })

      const row = await database.getEmailReplyToken({
        tokenHash: hashReplyToken(minted!.token)
      })
      expect(row?.tokenHash).toBe(hashReplyToken(minted!.token))
      expect(JSON.stringify(row)).not.toContain(minted!.token)
    })

    it('mints a distinct token every time', async () => {
      const first = await mintReplyToken(database, {
        actorId: ACTOR_ID,
        statusId: STATUS_ID,
        notificationType: 'reply'
      })
      const second = await mintReplyToken(database, {
        actorId: ACTOR_ID,
        statusId: STATUS_ID,
        notificationType: 'reply'
      })
      expect(first?.token).not.toBe(second?.token)
    })

    it('returns null when inbound email is not configured', async () => {
      mockGetConfig.mockReturnValue({ ...baseConfig, emailInbound: undefined })
      await expect(
        mintReplyToken(database, {
          actorId: ACTOR_ID,
          statusId: STATUS_ID,
          notificationType: 'reply'
        })
      ).resolves.toBeNull()
    })

    it('reports an unknown token as unknown', async () => {
      await expect(
        resolveReplyToken(database, 'never-minted')
      ).resolves.toEqual({ status: 'unknown' })
    })

    it('does not resolve an expired token', async () => {
      const minted = await mintReplyToken(database, {
        actorId: ACTOR_ID,
        statusId: STATUS_ID,
        notificationType: 'reply'
      })
      const row = await database.getEmailReplyToken({
        tokenHash: hashReplyToken(minted!.token)
      })
      expect(row!.expiresAt).toBeGreaterThan(Date.now())
      expect(row!.expiresAt).toBeLessThanOrEqual(
        Date.now() + REPLY_TOKEN_TTL_MS
      )

      // The TTL is a month, so travel past the row's expiry rather than
      // waiting it out.
      vi.useFakeTimers()
      vi.setSystemTime(new Date(row!.expiresAt + 1))
      try {
        // Distinguished from 'unknown' on purpose: the row still names its
        // owner, so the job can tell them instead of dropping the reply.
        await expect(
          resolveReplyToken(database, minted!.token)
        ).resolves.toMatchObject({ status: 'expired' })
      } finally {
        vi.useRealTimers()
      }
    })

    it('reports a token that spent its use ceiling as exhausted', async () => {
      const minted = await mintReplyToken(database, {
        actorId: ACTOR_ID,
        statusId: STATUS_ID,
        notificationType: 'reply'
      })
      const row = await database.getEmailReplyToken({
        tokenHash: hashReplyToken(minted!.token)
      })

      for (let use = 0; use < REPLY_TOKEN_MAX_USES; use += 1) {
        await database.recordEmailReplyTokenUse({ id: row!.id })
      }

      await expect(
        resolveReplyToken(database, minted!.token)
      ).resolves.toMatchObject({ status: 'exhausted' })
    })

    describe('createReplyToAddress', () => {
      const params = {
        actorId: ACTOR1_ID,
        statusId: `${ACTOR1_ID}/statuses/post-1`,
        notificationType: 'reply' as const
      }

      afterEach(async () => {
        await database.updateActor({
          actorId: ACTOR1_ID,
          replyByEmail: false
        })
        await database.deleteServerSetting({ key: 'replyByEmail.enabled' })
        invalidateServerSettingsCache(database)
      })

      it('returns undefined when the actor has not opted in', async () => {
        await expect(
          createReplyToAddress(database, params)
        ).resolves.toBeUndefined()
      })

      it('returns a reply address once the actor opts in', async () => {
        await database.updateActor({
          actorId: ACTOR1_ID,
          replyByEmail: true
        })

        const address = await createReplyToAddress(database, params)
        expect(address).toMatch(/^reply\+[A-Za-z0-9_-]+@reply\.llun\.dev$/)

        const token = extractReplyTokenFromAddress(address!)
        await expect(
          resolveReplyToken(database, token!)
        ).resolves.toMatchObject({ status: 'ok', token: params })
      })

      it('returns undefined when the admin switch is off', async () => {
        await database.updateActor({
          actorId: ACTOR1_ID,
          replyByEmail: true
        })
        await database.setServerSetting({
          key: 'replyByEmail.enabled',
          value: false
        })
        invalidateServerSettingsCache(database)

        await expect(
          createReplyToAddress(database, params)
        ).resolves.toBeUndefined()
      })

      it('returns undefined when inbound email is not configured', async () => {
        await database.updateActor({
          actorId: ACTOR1_ID,
          replyByEmail: true
        })
        mockGetConfig.mockReturnValue({
          ...baseConfig,
          emailInbound: undefined
        })

        await expect(
          createReplyToAddress(database, params)
        ).resolves.toBeUndefined()
      })

      it('returns undefined rather than throwing when the mint fails', async () => {
        await database.updateActor({
          actorId: ACTOR1_ID,
          replyByEmail: true
        })
        const createEmailReplyToken = vi
          .spyOn(database, 'createEmailReplyToken')
          .mockRejectedValue(new Error('database unavailable'))

        try {
          await expect(
            createReplyToAddress(database, params)
          ).resolves.toBeUndefined()
        } finally {
          createEmailReplyToken.mockRestore()
        }
      })
    })
  })
})
