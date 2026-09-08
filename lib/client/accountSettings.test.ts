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

    it('decodes API error message on non-ok response', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({ error: 'Server not reachable' }),
        { status: 400 }
      )

      await expect(
        getRemoteFollowUrl({
          account: 'user@bad.example',
          target: 'https://local.example/users/alice'
        })
      ).rejects.toThrow('Server not reachable')
    })

    it('falls back to default error message on non-JSON failure', async () => {
      fetchMock.mockResponseOnce('Server error', { status: 500 })

      await expect(
        getRemoteFollowUrl({
          account: 'user@bad.example',
          target: 'https://local.example/users/alice'
        })
      ).rejects.toThrow('Unable to reach that server')
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

    it('propagates network failure', async () => {
      fetchMock.mockRejectOnce(new Error('Network offline'))

      await expect(
        getRemoteFollowUrl({
          account: 'user@example.com',
          target: 'https://local.example/users/alice'
        })
      ).rejects.toThrow('Network offline')
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

    it('decodes API error message on failure', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({ error: 'Email already in use' }),
        { status: 400 }
      )

      await expect(
        requestEmailChange({ newEmail: 'used@example.com' })
      ).rejects.toThrow('Email already in use')
    })

    it('falls back to default error message on non-JSON failure', async () => {
      fetchMock.mockResponseOnce('Internal Server Error', { status: 500 })

      await expect(
        requestEmailChange({ newEmail: 'fail@example.com' })
      ).rejects.toThrow('Failed to request email change')
    })

    it('propagates network failure', async () => {
      fetchMock.mockRejectOnce(new Error('Network failed'))

      await expect(
        requestEmailChange({ newEmail: 'net@example.com' })
      ).rejects.toThrow('Network failed')
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

    it('decodes API error message on validation failure', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ error: 'Invalid name' }), {
        status: 422
      })

      await expect(
        updateAccountName({ name: 'x'.repeat(300) })
      ).rejects.toThrow('Invalid name')
    })

    it('falls back to default error message on failure', async () => {
      fetchMock.mockResponseOnce('', { status: 500 })

      await expect(updateAccountName({ name: 'Bob' })).rejects.toThrow(
        'Failed to update name'
      )
    })

    it('propagates network failure', async () => {
      fetchMock.mockRejectOnce(new Error('Connection reset'))

      await expect(updateAccountName({ name: 'Bob' })).rejects.toThrow(
        'Connection reset'
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

    it('decodes API error when current password is incorrect', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({ error: 'Current password is incorrect' }),
        { status: 400 }
      )

      await expect(
        changeAccountPassword({
          currentPassword: 'wrong-password',
          newPassword: 'new-password'
        })
      ).rejects.toThrow('Current password is incorrect')
    })

    it('falls back to default error on non-JSON failure', async () => {
      fetchMock.mockResponseOnce('Bad Gateway', { status: 502 })

      await expect(
        changeAccountPassword({
          currentPassword: 'old-password',
          newPassword: 'new-password'
        })
      ).rejects.toThrow('Failed to change password')
    })

    it('propagates network failure', async () => {
      fetchMock.mockRejectOnce(new Error('Network timeout'))

      await expect(
        changeAccountPassword({
          currentPassword: 'old-password',
          newPassword: 'new-password'
        })
      ).rejects.toThrow('Network timeout')
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

    it('decodes API error message on failure', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ error: 'Bad Request' }), {
        status: 400
      })

      await expect(
        requestPasswordReset({ email: 'invalid-email' })
      ).rejects.toThrow('Bad Request')
    })

    it('falls back to default error message on non-JSON failure', async () => {
      fetchMock.mockResponseOnce('Server Error', { status: 500 })

      await expect(
        requestPasswordReset({ email: 'test@example.com' })
      ).rejects.toThrow('Failed to request password reset')
    })

    it('propagates network failure', async () => {
      fetchMock.mockRejectOnce(new Error('Network connection failed'))

      await expect(
        requestPasswordReset({ email: 'test@example.com' })
      ).rejects.toThrow('Network connection failed')
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

    it('decodes API error when reset code is invalid or expired', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({ error: 'Invalid or expired reset code' }),
        { status: 400 }
      )

      await expect(
        resetPassword({
          code: 'expired-code',
          newPassword: 'new-password-123'
        })
      ).rejects.toThrow('Invalid or expired reset code')
    })

    it('falls back to default error on non-JSON failure', async () => {
      fetchMock.mockResponseOnce('Internal Server Error', { status: 500 })

      await expect(
        resetPassword({
          code: 'any-code',
          newPassword: 'new-password-123'
        })
      ).rejects.toThrow('Failed to reset password')
    })

    it('propagates network failure', async () => {
      fetchMock.mockRejectOnce(new Error('Network offline'))

      await expect(
        resetPassword({
          code: 'any-code',
          newPassword: 'new-password-123'
        })
      ).rejects.toThrow('Network offline')
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

    it('decodes API error message on non-ok response', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({ error: 'invalid_request: missing oauth query' }),
        { status: 400 }
      )

      await expect(
        submitOAuthConsent({
          accept: true,
          scope: 'read',
          oauth_query: ''
        })
      ).rejects.toThrow('invalid_request: missing oauth query')
    })

    it('falls back to default error on non-JSON failure', async () => {
      fetchMock.mockResponseOnce('Internal Server Error', { status: 500 })

      await expect(
        submitOAuthConsent({
          accept: true,
          scope: 'read',
          oauth_query: 'client_id=flow-test-client'
        })
      ).rejects.toThrow('Failed to submit consent')
    })

    it('propagates network failure', async () => {
      fetchMock.mockRejectOnce(new Error('Network error'))

      await expect(
        submitOAuthConsent({
          accept: false,
          oauth_query: 'client_id=flow-test-client'
        })
      ).rejects.toThrow('Network error')
    })
  })
})
