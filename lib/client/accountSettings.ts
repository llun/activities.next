import { throwApiError } from './http'

export interface RemoteFollowParams {
  account: string
  target: string
}

export interface RemoteFollowResponse {
  url: string
}

/**
 * Resolves where to send a logged-out visitor so they can follow a local
 * account from their own fediverse server. The lookup runs server-side (the
 * visitor's WebFinger document is not readable from the browser), and the
 * returned URL is always absolute and https.
 */
export const getRemoteFollowUrl = async ({
  account,
  target
}: RemoteFollowParams): Promise<string> => {
  const params = new URLSearchParams({ account, target })
  const response = await fetch(`/api/v1/remote-follow?${params.toString()}`, {
    method: 'GET',
    headers: {
      Accept: 'application/json'
    }
  })
  if (!response.ok) {
    await throwApiError(response, 'Unable to reach that server')
  }

  const data = await response.json()
  if (typeof data?.url !== 'string') {
    throw new Error('Unable to reach that server')
  }
  return data.url
}

export interface RequestEmailChangeParams {
  newEmail: string
}

export interface RequestEmailChangeResponse {
  message: string
}

export const requestEmailChange = async ({
  newEmail
}: RequestEmailChangeParams): Promise<RequestEmailChangeResponse> => {
  const response = await fetch('/api/v1/accounts/email', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ newEmail })
  })
  if (!response.ok) {
    await throwApiError(response, 'Failed to request email change')
  }
  return response.json()
}

export interface UpdateAccountNameParams {
  name: string
}

export interface UpdateAccountNameResponse {
  success: boolean
}

export const updateAccountName = async ({
  name
}: UpdateAccountNameParams): Promise<UpdateAccountNameResponse> => {
  const response = await fetch('/api/v1/accounts/name', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ name })
  })
  if (!response.ok) {
    await throwApiError(response, 'Failed to update name')
  }
  return response.json()
}

export interface ChangeAccountPasswordParams {
  currentPassword: string
  newPassword: string
}

export interface ChangeAccountPasswordResponse {
  success: boolean
  message?: string
}

export const changeAccountPassword = async ({
  currentPassword,
  newPassword
}: ChangeAccountPasswordParams): Promise<ChangeAccountPasswordResponse> => {
  const response = await fetch('/api/v1/accounts/password', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ currentPassword, newPassword })
  })
  if (!response.ok) {
    await throwApiError(response, 'Failed to change password')
  }
  return response.json()
}

export interface RequestPasswordResetParams {
  email: string
}

export interface RequestPasswordResetResponse {
  success: boolean
  message: string
}

export const requestPasswordReset = async ({
  email
}: RequestPasswordResetParams): Promise<RequestPasswordResetResponse> => {
  const response = await fetch('/api/v1/accounts/password/reset/request', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ email })
  })
  if (!response.ok) {
    await throwApiError(response, 'Failed to request password reset')
  }
  return response.json()
}

export interface ResetPasswordParams {
  code: string
  newPassword: string
}

export interface ResetPasswordResponse {
  success: boolean
  message: string
}

export const resetPassword = async ({
  code,
  newPassword
}: ResetPasswordParams): Promise<ResetPasswordResponse> => {
  const response = await fetch('/api/v1/accounts/password/reset', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ code, newPassword })
  })
  if (!response.ok) {
    await throwApiError(response, 'Failed to reset password')
  }
  return response.json()
}

export interface OAuthConsentResponse {
  redirect?: boolean
  url?: string
  // Legacy shape from the original custom consent handler.
  redirect_uri?: string
}

export type ConsentResponse = OAuthConsentResponse

export interface SubmitOAuthConsentParams {
  accept: boolean
  scope?: string
  oauth_query: string
}

export type OAuthConsentAction = 'approve' | 'deny'

export const submitOAuthConsent = async ({
  accept,
  scope,
  oauth_query
}: SubmitOAuthConsentParams): Promise<OAuthConsentResponse> => {
  const response = await fetch('/api/auth/oauth2/consent', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      accept,
      ...(scope !== undefined ? { scope } : {}),
      oauth_query
    })
  })
  if (!response.ok) {
    await throwApiError(response, 'Failed to submit consent')
  }
  return response.json()
}
