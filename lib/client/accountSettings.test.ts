import fetchMock from 'jest-fetch-mock'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  changeAccountPassword,
  getRemoteFollowUrl,
  requestEmailChange,
  requestPasswordReset,
  resetPassword,
  submitOAuthConsent,
  updateAccountName
} from './accountSettings'

describe('accountSettings client module', () => {
  beforeEach(() => {
    fetchMock.resetMocks()
  })

  describe('getRemoteFollowUrl', () => {
    it('fetches remote follow url with account and target query params', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({
          url: 'https://remote.server/authorize_interaction?uri=alice'
        }),
        { status: 200 }
      )

      const result = await getRemoteFollowUrl({
        account: 'alice@local.example',
        target: 'https://local.example/users/alice'
      })

      expect(result).toBe(
        'https://remote.server/authorize_interaction?uri=alice'
      )
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/remote-follow?account=alice%40local.example&target=https%3A%2F%2Flocal.example%2Fusers%2Falice',
        expect.objectContaining({
          method: 'GET',
          headers: {
            Accept: 'application/json'
          }
        })
      )
    })

    it('throws error when data.url is missing or not a string', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({}), { status: 200 })

      await expect(
        getRemoteFollowUrl({
          account: 'user@bad.example',
          target: 'https://local.example/users/alice'
        })
      ).rejects.toThrow('Unable to reach that server')
    })
  })

  describe('requestEmailChange', () => {
    it('requests email change with newEmail payload', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({ message: 'Verification email sent' }),
        { status: 200 }
      )

      const result = await requestEmailChange({ newEmail: 'new@example.com' })

      expect(result).toEqual({ message: 'Verification email sent' })
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/accounts/email',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ newEmail: 'new@example.com' })
        })
      )
    })
  })

  describe('updateAccountName', () => {
    it('updates account name with name payload', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ success: true }), {
        status: 200
      })

      const result = await updateAccountName({ name: 'Alice Wonderland' })

      expect(result).toEqual({ success: true })
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/accounts/name',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Alice Wonderland' })
        })
      )
    })
  })

  describe('changeAccountPassword', () => {
    it('changes password with current and new password payload', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({
          success: true,
          message: 'Password changed successfully'
        }),
        { status: 200 }
      )

      const result = await changeAccountPassword({
        currentPassword: 'old-password',
        newPassword: 'new-password'
      })

      expect(result).toEqual({
        success: true,
        message: 'Password changed successfully'
      })
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/accounts/password',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            currentPassword: 'old-password',
            newPassword: 'new-password'
          })
        })
      )
    })
  })

  describe('requestPasswordReset', () => {
    it('requests password reset with email payload', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({
          success: true,
          message:
            'If an account exists for that email, a password reset link has been sent.'
        }),
        { status: 200 }
      )

      const result = await requestPasswordReset({
        email: 'test@example.com'
      })

      expect(result).toEqual({
        success: true,
        message:
          'If an account exists for that email, a password reset link has been sent.'
      })
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/accounts/password/reset/request',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'test@example.com' })
        })
      )
    })
  })

  describe('resetPassword', () => {
    it('resets password with code and newPassword payload', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({
          success: true,
          message: 'Password reset successfully'
        }),
        { status: 200 }
      )

      const result = await resetPassword({
        code: 'valid-reset-code',
        newPassword: 'new-password-123'
      })

      expect(result).toEqual({
        success: true,
        message: 'Password reset successfully'
      })
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/accounts/password/reset',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code: 'valid-reset-code',
            newPassword: 'new-password-123'
          })
        })
      )
    })
  })

  describe('submitOAuthConsent', () => {
    it('submits approval with exact keys and parses redirect response', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({
          redirect: true,
          url: 'https://client.example.com/callback?code=oauth-code'
        }),
        { status: 200 }
      )

      const result = await submitOAuthConsent({
        accept: true,
        scope: 'read write follow push',
        oauth_query: 'client_id=flow-test-client&response_type=code'
      })

      expect(result).toEqual({
        redirect: true,
        url: 'https://client.example.com/callback?code=oauth-code'
      })
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/auth/oauth2/consent',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            accept: true,
            scope: 'read write follow push',
            oauth_query: 'client_id=flow-test-client&response_type=code'
          })
        })
      )
    })

    it('submits denial with exact keys (omitting scope) and parses legacy redirect_uri', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({
          redirect: true,
          redirect_uri:
            'https://client.example.com/callback?error=access_denied'
        }),
        { status: 200 }
      )

      const result = await submitOAuthConsent({
        accept: false,
        oauth_query: 'client_id=flow-test-client&response_type=code'
      })

      expect(result).toEqual({
        redirect: true,
        redirect_uri: 'https://client.example.com/callback?error=access_denied'
      })
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/auth/oauth2/consent',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            accept: false,
            oauth_query: 'client_id=flow-test-client&response_type=code'
          })
        })
      )
    })
  })

  describe.each([
    {
      name: 'getRemoteFollowUrl',
      call: () =>
        getRemoteFollowUrl({
          account: 'user@bad.example',
          target: 'https://local.example/users/alice'
        }),
      apiError: 'Server not reachable',
      apiErrorStatus: 400,
      rawBody: 'Server error',
      rawStatus: 500,
      fallback: 'Unable to reach that server'
    },
    {
      name: 'requestEmailChange',
      call: () => requestEmailChange({ newEmail: 'new@example.com' }),
      apiError: 'Email already in use',
      apiErrorStatus: 400,
      rawBody: 'Internal Server Error',
      rawStatus: 500,
      fallback: 'Failed to request email change'
    },
    {
      name: 'updateAccountName',
      call: () => updateAccountName({ name: 'Bob' }),
      apiError: 'Invalid name',
      apiErrorStatus: 422,
      rawBody: '',
      rawStatus: 500,
      fallback: 'Failed to update name'
    },
    {
      name: 'changeAccountPassword',
      call: () =>
        changeAccountPassword({
          currentPassword: 'old-password',
          newPassword: 'new-password'
        }),
      apiError: 'Current password is incorrect',
      apiErrorStatus: 400,
      rawBody: 'Bad Gateway',
      rawStatus: 502,
      fallback: 'Failed to change password'
    },
    {
      name: 'requestPasswordReset',
      call: () => requestPasswordReset({ email: 'test@example.com' }),
      apiError: 'Bad Request',
      apiErrorStatus: 400,
      rawBody: 'Server Error',
      rawStatus: 500,
      fallback: 'Failed to request password reset'
    },
    {
      name: 'resetPassword',
      call: () =>
        resetPassword({ code: 'any-code', newPassword: 'new-password-123' }),
      apiError: 'Invalid or expired reset code',
      apiErrorStatus: 400,
      rawBody: 'Internal Server Error',
      rawStatus: 500,
      fallback: 'Failed to reset password'
    },
    {
      name: 'submitOAuthConsent',
      call: () =>
        submitOAuthConsent({
          accept: true,
          scope: 'read',
          oauth_query: 'client_id=flow-test-client'
        }),
      apiError: 'invalid_request: missing oauth query',
      apiErrorStatus: 400,
      rawBody: 'Internal Server Error',
      rawStatus: 500,
      fallback: 'Failed to submit consent'
    }
  ])(
    '$name failures',
    ({ call, apiError, apiErrorStatus, rawBody, rawStatus, fallback }) => {
      it('decodes the API error message', async () => {
        fetchMock.mockResponseOnce(JSON.stringify({ error: apiError }), {
          status: apiErrorStatus
        })

        await expect(call()).rejects.toThrow(apiError)
      })

      it('falls back to the default error message on a non-JSON failure', async () => {
        fetchMock.mockResponseOnce(rawBody, { status: rawStatus })

        await expect(call()).rejects.toThrow(fallback)
      })

      it('propagates network failure', async () => {
        fetchMock.mockRejectOnce(new Error('Network offline'))

        await expect(call()).rejects.toThrow('Network offline')
      })
    }
  )
})
