import fetchMock from 'jest-fetch-mock'
import { beforeEach, describe, expect, it } from 'vitest'

import type { AdminAccount } from '@/lib/types/mastodon/admin/account'

import {
  adminApproveAccount,
  adminDeleteAccount,
  adminEnableAccount,
  adminRejectAccount,
  adminUnsensitiveAccount,
  adminUnsilenceAccount,
  adminUnsuspendAccount,
  getAdminAccount,
  getAdminAccounts,
  performAdminAccountAction
} from './adminAccounts'

describe('adminAccounts client module', () => {
  beforeEach(() => {
    fetchMock.resetMocks()
  })

  const mockAdminAccount: AdminAccount = {
    id: 'account-1',
    username: 'alice',
    domain: null,
    created_at: '2026-01-01T00:00:00Z',
    email: 'alice@example.com',
    ip: '127.0.0.1',
    ips: [],
    locale: null,
    invite_request: null,
    role: null,
    confirmed: true,
    approved: true,
    disabled: false,
    silenced: false,
    suspended: false,
    sensitized: false,
    account: {} as AdminAccount['account']
  }

  describe('getAdminAccounts', () => {
    it('fetches accounts with default empty filters', async () => {
      fetchMock.mockResponseOnce(JSON.stringify([mockAdminAccount]), {
        status: 200
      })

      const result = await getAdminAccounts()

      expect(result).toEqual([mockAdminAccount])
      expect(fetchMock).toHaveBeenCalledWith('/api/v2/admin/accounts', {
        headers: { Accept: 'application/json' },
        credentials: 'include'
      })
    })

    it('appends query parameters when filters are provided', async () => {
      fetchMock.mockResponseOnce(JSON.stringify([mockAdminAccount]), {
        status: 200
      })

      await getAdminAccounts({
        origin: 'local',
        status: 'active',
        username: 'alice',
        byDomain: 'example.com'
      })

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v2/admin/accounts?origin=local&status=active&username=alice&by_domain=example.com',
        {
          headers: { Accept: 'application/json' },
          credentials: 'include'
        }
      )
    })

    it('throws error when response is not ok', async () => {
      fetchMock.mockResponseOnce('', { status: 500 })

      await expect(getAdminAccounts()).rejects.toThrow(
        'Failed to load admin accounts'
      )
    })
  })

  describe('getAdminAccount', () => {
    it('fetches single account by id', async () => {
      fetchMock.mockResponseOnce(JSON.stringify(mockAdminAccount), {
        status: 200
      })

      const result = await getAdminAccount('account-1')

      expect(result).toEqual(mockAdminAccount)
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/admin/accounts/account-1',
        {
          headers: { Accept: 'application/json' },
          credentials: 'include'
        }
      )
    })

    it('throws error when response is not ok', async () => {
      fetchMock.mockResponseOnce('', { status: 404 })

      await expect(getAdminAccount('account-1')).rejects.toThrow(
        'Failed to load admin account'
      )
    })
  })

  describe('performAdminAccountAction', () => {
    it('posts action payload with optional reportId and text', async () => {
      fetchMock.mockResponseOnce('', { status: 200 })

      await performAdminAccountAction({
        id: 'account-1',
        type: 'silence',
        reportId: 'rep-1',
        text: 'Violated terms'
      })

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/admin/accounts/account-1/action',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            type: 'silence',
            report_id: 'rep-1',
            text: 'Violated terms'
          })
        }
      )
    })

    it('posts action without optional fields when omitted', async () => {
      fetchMock.mockResponseOnce('', { status: 200 })

      await performAdminAccountAction({
        id: 'account-1',
        type: 'disable'
      })

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/admin/accounts/account-1/action',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            type: 'disable'
          })
        }
      )
    })

    it('throws custom error when response is not ok', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({ error: 'Cannot perform action on self' }),
        { status: 422 }
      )

      await expect(
        performAdminAccountAction({ id: 'account-1', type: 'suspend' })
      ).rejects.toThrow('Cannot perform action on self')
    })

    it('throws fallback error when response has no error message', async () => {
      fetchMock.mockResponseOnce('Server error', { status: 500 })

      await expect(
        performAdminAccountAction({ id: 'account-1', type: 'suspend' })
      ).rejects.toThrow('Failed to perform account action')
    })
  })

  describe('admin account state change actions', () => {
    const actions = [
      {
        name: 'adminEnableAccount',
        fn: adminEnableAccount,
        endpoint: 'enable'
      },
      {
        name: 'adminUnsilenceAccount',
        fn: adminUnsilenceAccount,
        endpoint: 'unsilence'
      },
      {
        name: 'adminUnsuspendAccount',
        fn: adminUnsuspendAccount,
        endpoint: 'unsuspend'
      },
      {
        name: 'adminUnsensitiveAccount',
        fn: adminUnsensitiveAccount,
        endpoint: 'unsensitive'
      },
      {
        name: 'adminApproveAccount',
        fn: adminApproveAccount,
        endpoint: 'approve'
      },
      { name: 'adminRejectAccount', fn: adminRejectAccount, endpoint: 'reject' }
    ]

    for (const { name, fn, endpoint } of actions) {
      it(`${name} calls correct endpoint and returns updated account`, async () => {
        fetchMock.mockResponseOnce(JSON.stringify(mockAdminAccount), {
          status: 200
        })

        const result = await fn('account-1')

        expect(result).toEqual(mockAdminAccount)
        expect(fetchMock).toHaveBeenCalledWith(
          `/api/v1/admin/accounts/account-1/${endpoint}`,
          {
            method: 'POST',
            credentials: 'include'
          }
        )
      })

      it(`${name} throws error when response fails`, async () => {
        fetchMock.mockResponseOnce(
          JSON.stringify({ error: `Could not ${endpoint}` }),
          { status: 400 }
        )

        await expect(fn('account-1')).rejects.toThrow(`Could not ${endpoint}`)
      })
    }
  })

  describe('adminDeleteAccount', () => {
    it('sends DELETE request and returns account', async () => {
      fetchMock.mockResponseOnce(JSON.stringify(mockAdminAccount), {
        status: 200
      })

      const result = await adminDeleteAccount('account-1')

      expect(result).toEqual(mockAdminAccount)
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/admin/accounts/account-1',
        {
          method: 'DELETE',
          credentials: 'include'
        }
      )
    })

    it('throws custom error when delete fails', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({ error: 'Cannot delete admin' }),
        { status: 403 }
      )

      await expect(adminDeleteAccount('account-1')).rejects.toThrow(
        'Cannot delete admin'
      )
    })

    it('throws default error when delete fails without json error', async () => {
      fetchMock.mockResponseOnce('', { status: 500 })

      await expect(adminDeleteAccount('account-1')).rejects.toThrow(
        'Failed to delete account'
      )
    })
  })
})
