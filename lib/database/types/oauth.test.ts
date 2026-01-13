import { DateInterval, generateRandomToken } from '@jmondi/oauth2-server'

import { DEFAULT_OAUTH_TOKEN_LENGTH } from '@/lib/constants'
import { Account } from '@/lib/models/account'
import { Actor } from '@/lib/models/actor'
import { AuthCode } from '@/lib/models/oauth2/authCode'
import { Client } from '@/lib/models/oauth2/client'
import { Token } from '@/lib/models/oauth2/token'
import { TEST_DOMAIN, TEST_PASSWORD_HASH } from '@/lib/stub/const'

import {
  TestDatabaseTable,
  databaseBeforeAll,
  getTestDatabaseTable
} from '../testUtils'
import { Scope } from './oauth'

describe('OAuthDatabase', () => {
  const table: TestDatabaseTable = getTestDatabaseTable()
  const TEST_EMAIL = `oauth-test@${TEST_DOMAIN}`
  const TEST_USERNAME = 'oauth-test'

  beforeAll(async () => {
    await databaseBeforeAll(table)
  })

  afterAll(async () => {
    await Promise.all(table.map((item) => item[1].destroy()))
  })

  describe.each(table)('%s', (_, database) => {
    beforeAll(async () => {
      await database.createAccount({
        email: TEST_EMAIL,
        username: TEST_USERNAME,
        passwordHash: TEST_PASSWORD_HASH,
        domain: TEST_DOMAIN,
        privateKey: 'privateKey-oauth',
        publicKey: 'publicKey-oauth'
      })

      await Promise.all([
        database.createClient({
          name: 'oauth-app1',
          redirectUris: ['https://oauth-app1.llun.dev/oauth/redirect'],
          scopes: [Scope.enum.read],
          secret: 'secret'
        }),
        database.createClient({
          name: 'oauth-app2',
          redirectUris: ['https://oauth-app2.llun.dev/oauth/redirect'],
          scopes: [Scope.enum.read, Scope.enum.write],
          secret: 'secret'
        })
      ])
    })

    describe('clients', () => {
      it('adds client record and returns client model', async () => {
        const client = await database.createClient({
          name: 'oauth-app3',
          redirectUris: ['https://oauth-app3.llun.dev/oauth/redirect'],
          scopes: [Scope.enum.read, Scope.enum.write],
          secret: 'some random secret'
        })
        expect(client).toEqual({
          id: expect.toBeString(),
          name: 'oauth-app3',
          secret: 'some random secret',
          scopes: [{ name: 'read' }, { name: 'write' }],
          redirectUris: ['https://oauth-app3.llun.dev/oauth/redirect'],
          allowedGrants: [
            'client_credentials',
            'authorization_code',
            'refresh_token'
          ],
          createdAt: expect.toBeNumber(),
          updatedAt: expect.toBeNumber()
        })
      })

      it('throws when failed validation', async () => {
        await expect(
          database.createClient({
            name: 'oauth-app-invalid',
            redirectUris: ['somerandomstring'],
            scopes: [Scope.enum.read, Scope.enum.write],
            secret: 'some random secret'
          })
        ).rejects.toThrow()
      })

      it('throws when application name already exists', async () => {
        await expect(
          database.createClient({
            name: 'oauth-app1',
            redirectUris: ['https://oauth-app1.llun.dev/oauth/redirect'],
            scopes: [Scope.enum.read, Scope.enum.write],
            secret: 'some random secret'
          })
        ).rejects.toThrow('Client oauth-app1 is already exists')
      })

      it('returns existing client in storage', async () => {
        const application = await database.getClientFromName({
          name: 'oauth-app1'
        })
        const withIdApplication = await database.getClientFromId({
          clientId: (application as Client).id
        })

        expect(application).toEqual({
          id: expect.toBeString(),
          name: 'oauth-app1',
          secret: 'secret',
          scopes: [{ name: 'read' }],
          redirectUris: ['https://oauth-app1.llun.dev/oauth/redirect'],
          allowedGrants: [
            'client_credentials',
            'authorization_code',
            'refresh_token'
          ],
          createdAt: expect.toBeNumber(),
          updatedAt: expect.toBeNumber()
        })
        expect(withIdApplication).toEqual({
          id: expect.toBeString(),
          name: 'oauth-app1',
          secret: 'secret',
          scopes: [{ name: 'read' }],
          redirectUris: ['https://oauth-app1.llun.dev/oauth/redirect'],
          allowedGrants: [
            'client_credentials',
            'authorization_code',
            'refresh_token'
          ],
          createdAt: expect.toBeNumber(),
          updatedAt: expect.toBeNumber()
        })
      })

      it('updates client and returns the updated client', async () => {
        const existingClient = await database.getClientFromName({
          name: 'oauth-app2'
        })
        if (!existingClient) fail('Client must exists')

        const client = await database.updateClient({
          id: existingClient.id,
          name: 'oauth-app2',
          redirectUris: ['https://oauth-app2.llun.dev/oauth/redirect'],
          scopes: [Scope.enum.read],
          secret: 'secret'
        })
        const updatedExistingClient = await database.getClientFromName({
          name: 'oauth-app2'
        })

        if (!client) fail('Client must exists')
        expect(client).toEqual(updatedExistingClient)
        expect(client.scopes).toEqual([{ name: 'read' }])
      })
    })

    describe('tokens', () => {
      let token: Token | null
      let actor: Actor | undefined
      let client: Client | null

      beforeAll(async () => {
        ;[actor, client] = await Promise.all([
          database.getActorFromEmail({ email: TEST_EMAIL }),
          database.getClientFromName({ name: 'oauth-app1' })
        ])

        token = await database.createAccessToken({
          accessToken: generateRandomToken(DEFAULT_OAUTH_TOKEN_LENGTH),
          accessTokenExpiresAt: new DateInterval('30d').getEndDate().getTime(),
          accountId: (actor?.account as Account).id,
          actorId: actor?.id as string,
          clientId: client?.id as string,
          scopes: [Scope.enum.read]
        })
      })

      it('adds token to the repository', async () => {
        const newToken = await database.createAccessToken({
          accessToken: generateRandomToken(DEFAULT_OAUTH_TOKEN_LENGTH),
          accessTokenExpiresAt: new DateInterval('30d').getEndDate().getTime(),
          accountId: (actor?.account as Account).id,
          actorId: actor?.id as string,
          clientId: client?.id as string,
          scopes: [Scope.enum.read]
        })
        expect(newToken?.client).toEqual(client)
        expect(newToken?.user?.actor).toEqual(actor)
        expect(newToken?.user?.id).toEqual(actor?.id)
      })

      it('adds refresh token to access token', async () => {
        const refreshToken = generateRandomToken(DEFAULT_OAUTH_TOKEN_LENGTH)
        const refreshTokenExpiresAt = new DateInterval('2d')
          .getEndDate()
          .getTime()

        await database.updateRefreshToken({
          accessToken: token?.accessToken as string,
          refreshToken,
          refreshTokenExpiresAt
        })

        token = await database.getAccessToken({
          accessToken: token?.accessToken as string
        })
        expect(token?.refreshToken).toEqual(refreshToken)
        expect(token?.refreshTokenExpiresAt?.getTime()).toEqual(
          refreshTokenExpiresAt
        )

        const tokenFromRefreshToken =
          await database.getAccessTokenByRefreshToken({
            refreshToken
          })
        expect(tokenFromRefreshToken).toEqual(token)
      })

      it('sets expires at for both tokens when revoking access token', async () => {
        const revokedToken = await database.revokeAccessToken({
          accessToken: token?.accessToken as string
        })
        expect(revokedToken?.accessTokenExpiresAt).toBeDefined()
        expect(revokedToken?.refreshTokenExpiresAt).toBeDefined()
        expect(revokedToken?.accessTokenExpiresAt.getTime()).toEqual(
          revokedToken?.refreshTokenExpiresAt?.getTime()
        )
      })
    })

    describe('authCode', () => {
      let actor: Actor | undefined
      let client: Client | null
      let code: AuthCode | null

      beforeAll(async () => {
        ;[actor, client] = await Promise.all([
          database.getActorFromEmail({ email: TEST_EMAIL }),
          database.getClientFromName({ name: 'oauth-app1' })
        ])

        code = await database.createAuthCode({
          code: generateRandomToken(DEFAULT_OAUTH_TOKEN_LENGTH),
          redirectUri: 'https://oauth-app1.llun.dev/oauth/redirect',
          codeChallenge: 'challenge',
          codeChallengeMethod: 'plain',
          clientId: client?.id as string,
          accountId: actor?.account?.id as string,
          actorId: actor?.id as string,
          scopes: [Scope.enum.read],
          expiresAt: new DateInterval('50m').getEndDate().getTime()
        })
      })

      it('adds authCode to the repository', async () => {
        const newCode = await database.createAuthCode({
          code: generateRandomToken(DEFAULT_OAUTH_TOKEN_LENGTH),
          redirectUri: null,
          codeChallenge: null,
          codeChallengeMethod: 'S256',
          clientId: client?.id as string,
          accountId: actor?.account?.id as string,
          actorId: actor?.id as string,
          scopes: [Scope.enum.read],
          expiresAt: new DateInterval('50m').getEndDate().getTime()
        })

        expect(newCode?.client).toEqual(client)
        expect(newCode?.user?.actor).toEqual(actor)
        expect(newCode?.user?.id).toEqual(actor?.id)
      })

      it('returns authCode from storage', async () => {
        const codeFromStorage = await database.getAuthCode({
          code: code?.code as string
        })
        expect(codeFromStorage).toEqual(code)
      })

      it('sets expires at when revoking authCode', async () => {
        const revokedAuthCode = await database.revokeAuthCode({
          code: code?.code as string
        })
        expect(revokedAuthCode?.expiresAt).toBeDefined()
      })
    })
  })
})
