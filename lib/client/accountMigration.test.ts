import fetchMock from 'jest-fetch-mock'
import { beforeEach, describe, expect, it } from 'vitest'

import * as clientIndex from '@/lib/client'

import {
  addAccountAlias,
  cancelAccountRedirect,
  getAccountAliases,
  getAccountHandle,
  getAccountMigration,
  moveAccount,
  removeAccountAlias,
  renameAccountHandle
} from './accountMigration'

const HANDLE_STATE = {
  actorId: 'https://llun.test/users/anna',
  username: 'anna',
  domain: 'llun.test',
  acct: 'anna@llun.test',
  history: [
    {
      id: 'h1',
      actorId: 'https://llun.test/users/anna',
      username: 'anna',
      domain: 'llun.test',
      createdAt: 1700000000000,
      replacedAt: null
    }
  ],
  cooldownUntil: null,
  domains: ['llun.test']
}

const ALIASES = [
  { id: 'https://old.example/users/anna', acct: 'anna@old.example' }
]

const MIGRATION_STATE = {
  movedTo: null,
  migrations: [],
  cooldownUntil: null,
  followersCount: 12
}

describe('accountMigration client module', () => {
  beforeEach(() => {
    fetchMock.resetMocks()
  })

  it('is re-exported from lib/client', () => {
    // The one export line slice 3 owns in lib/client.ts.
    expect(clientIndex.getAccountHandle).toBe(getAccountHandle)
    expect(clientIndex.renameAccountHandle).toBe(renameAccountHandle)
    expect(clientIndex.getAccountAliases).toBe(getAccountAliases)
    expect(clientIndex.addAccountAlias).toBe(addAccountAlias)
    expect(clientIndex.removeAccountAlias).toBe(removeAccountAlias)
    expect(clientIndex.getAccountMigration).toBe(getAccountMigration)
    expect(clientIndex.moveAccount).toBe(moveAccount)
    expect(clientIndex.cancelAccountRedirect).toBe(cancelAccountRedirect)
  })

  it('sends actorId as a query on the handle GET', async () => {
    fetchMock.mockResponseOnce(JSON.stringify(HANDLE_STATE), { status: 200 })

    const result = await getAccountHandle({
      actorId: 'https://llun.test/users/anna'
    })

    expect(result.acct).toBe('anna@llun.test')
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/accounts/handle?actorId=https%3A%2F%2Fllun.test%2Fusers%2Fanna',
      expect.objectContaining({ method: 'GET' })
    )
  })

  it('sends actorId in the rename POST body', async () => {
    fetchMock.mockResponseOnce(JSON.stringify(HANDLE_STATE), { status: 200 })

    await renameAccountHandle({
      actorId: 'https://llun.test/users/anna',
      username: 'anna2',
      domain: 'run.llun.dev',
      password: 'secret'
    })

    const [, options] = fetchMock.mock.calls[0]
    expect(options?.method).toBe('POST')
    expect(JSON.parse(String(options?.body))).toEqual({
      actorId: 'https://llun.test/users/anna',
      username: 'anna2',
      domain: 'run.llun.dev',
      password: 'secret'
    })
  })

  it('sends the current username, not the password, for a passwordless rename', async () => {
    fetchMock.mockResponseOnce(JSON.stringify(HANDLE_STATE), { status: 200 })

    await renameAccountHandle({
      actorId: 'https://llun.test/users/anna',
      username: 'anna2',
      currentUsername: 'anna'
    })

    const [, options] = fetchMock.mock.calls[0]
    expect(JSON.parse(String(options?.body))).toEqual({
      actorId: 'https://llun.test/users/anna',
      username: 'anna2',
      currentUsername: 'anna'
    })
  })

  it('throws the server error message from a failed rename', async () => {
    fetchMock.mockResponseOnce(
      JSON.stringify({ error: 'Username already exists' }),
      { status: 422 }
    )

    await expect(
      renameAccountHandle({
        actorId: 'https://llun.test/users/anna',
        username: 'taken',
        password: 'secret'
      })
    ).rejects.toThrow('Username already exists')
  })

  it('sends actorId as a query on the aliases GET', async () => {
    fetchMock.mockResponseOnce(JSON.stringify(ALIASES), { status: 200 })

    const result = await getAccountAliases({
      actorId: 'https://llun.test/users/anna'
    })

    expect(result).toEqual(ALIASES)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/accounts/aliases?actorId=https%3A%2F%2Fllun.test%2Fusers%2Fanna',
      expect.objectContaining({ method: 'GET' })
    )
  })

  it('sends the alias acct and actorId in the add POST body', async () => {
    fetchMock.mockResponseOnce(JSON.stringify(ALIASES), { status: 200 })

    await addAccountAlias({
      actorId: 'https://llun.test/users/anna',
      acct: 'anna@old.example'
    })

    const [, options] = fetchMock.mock.calls[0]
    expect(options?.method).toBe('POST')
    expect(JSON.parse(String(options?.body))).toEqual({
      actorId: 'https://llun.test/users/anna',
      acct: 'anna@old.example'
    })
  })

  it('sends the alias id and actorId as queries on the remove DELETE', async () => {
    fetchMock.mockResponseOnce(JSON.stringify([]), { status: 200 })

    await removeAccountAlias({
      actorId: 'https://llun.test/users/anna',
      id: 'https://old.example/users/anna'
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/accounts/aliases?actorId=https%3A%2F%2Fllun.test%2Fusers%2Fanna&id=https%3A%2F%2Fold.example%2Fusers%2Fanna',
      expect.objectContaining({ method: 'DELETE' })
    )
  })

  it('sends actorId as a query on the migration GET', async () => {
    fetchMock.mockResponseOnce(JSON.stringify(MIGRATION_STATE), {
      status: 200
    })

    const result = await getAccountMigration({
      actorId: 'https://llun.test/users/anna'
    })

    expect(result.followersCount).toBe(12)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/accounts/migration?actorId=https%3A%2F%2Fllun.test%2Fusers%2Fanna',
      expect.objectContaining({ method: 'GET' })
    )
  })

  it('sends the move kind, acct and actorId in the move POST body', async () => {
    fetchMock.mockResponseOnce(JSON.stringify(MIGRATION_STATE), {
      status: 200
    })

    await moveAccount({
      actorId: 'https://llun.test/users/anna',
      acct: 'anna@new.example',
      kind: 'move',
      password: 'secret'
    })

    const [, options] = fetchMock.mock.calls[0]
    expect(options?.method).toBe('POST')
    expect(JSON.parse(String(options?.body))).toEqual({
      actorId: 'https://llun.test/users/anna',
      acct: 'anna@new.example',
      kind: 'move',
      password: 'secret'
    })
  })

  it('sends actorId as a query on the redirect cancel DELETE', async () => {
    fetchMock.mockResponseOnce(JSON.stringify(MIGRATION_STATE), {
      status: 200
    })

    await cancelAccountRedirect({
      actorId: 'https://llun.test/users/anna'
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/accounts/migration?actorId=https%3A%2F%2Fllun.test%2Fusers%2Fanna',
      expect.objectContaining({ method: 'DELETE' })
    )
  })

  it('throws the server error message from a failed move', async () => {
    fetchMock.mockResponseOnce(
      JSON.stringify({
        error: 'Add this account as an alias on the new account first'
      }),
      { status: 422 }
    )

    await expect(
      moveAccount({
        actorId: 'https://llun.test/users/anna',
        acct: 'anna@new.example',
        kind: 'move',
        password: 'secret'
      })
    ).rejects.toThrow('Add this account as an alias on the new account first')
  })
})
