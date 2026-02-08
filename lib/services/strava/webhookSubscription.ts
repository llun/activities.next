import { logger } from '@/lib/utils/logger'

export interface StravaSubscription {
  id: number
  callback_url: string
  created_at: string
  updated_at: string
}

interface CreateSubscriptionResponse {
  id: number
}

interface StravaErrorResponse {
  message?: string
  errors?: Array<{ resource: string; field: string; code: string }>
}

/**
 * Get the current webhook subscription for the app.
 * Each Strava app can only have one subscription.
 */
export async function getSubscription(
  clientId: string,
  clientSecret: string
): Promise<StravaSubscription | null> {
  const url = new URL('https://www.strava.com/api/v3/push_subscriptions')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('client_secret', clientSecret)

  const response = await fetch(url.toString(), {
    method: 'GET'
  })

  if (!response.ok) {
    const error = await response.text()
    logger.error({
      message: 'Failed to get Strava subscription',
      status: response.status,
      error
    })
    throw new Error(`Failed to get subscription: ${response.status}`)
  }

  const subscriptions: StravaSubscription[] = await response.json()
  return subscriptions.length > 0 ? subscriptions[0] : null
}

/**
 * Delete an existing webhook subscription.
 */
export async function deleteSubscription(
  clientId: string,
  clientSecret: string,
  subscriptionId: number
): Promise<void> {
  const url = new URL(
    `https://www.strava.com/api/v3/push_subscriptions/${subscriptionId}`
  )
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('client_secret', clientSecret)

  const response = await fetch(url.toString(), {
    method: 'DELETE'
  })

  if (!response.ok && response.status !== 204) {
    const error = await response.text()
    logger.error({
      message: 'Failed to delete Strava subscription',
      status: response.status,
      error
    })
    throw new Error(`Failed to delete subscription: ${response.status}`)
  }
}

/**
 * Create a new webhook subscription.
 * The callback URL must respond to Strava's validation request.
 */
export async function createSubscription(
  clientId: string,
  clientSecret: string,
  callbackUrl: string,
  verifyToken: string
): Promise<number> {
  const formData = new URLSearchParams()
  formData.append('client_id', clientId)
  formData.append('client_secret', clientSecret)
  formData.append('callback_url', callbackUrl)
  formData.append('verify_token', verifyToken)

  const response = await fetch(
    'https://www.strava.com/api/v3/push_subscriptions',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: formData.toString()
    }
  )

  if (!response.ok) {
    const errorText = await response.text()
    let parsedError: StravaErrorResponse | null = null

    try {
      parsedError = JSON.parse(errorText) as StravaErrorResponse
    } catch {
      // Ignore parse errors for non-JSON responses
    }

    logger.error({
      message: 'Failed to create Strava subscription',
      status: response.status,
      error: errorText
    })
    throw new Error(
      parsedError?.message ||
        `Failed to create subscription: ${response.status}`
    )
  }

  const data: CreateSubscriptionResponse = await response.json()
  return data.id
}

interface EnsureWebhookSubscriptionParams {
  clientId: string
  clientSecret: string
  callbackUrl: string
  verifyToken: string
}

interface EnsureWebhookSubscriptionResult {
  success: boolean
  subscriptionId?: number
  error?: string
}

/**
 * Ensure a webhook subscription exists with the correct callback URL.
 * If a subscription exists with a different callback URL, it will be deleted
 * and a new one created.
 */
export async function ensureWebhookSubscription(
  params: EnsureWebhookSubscriptionParams
): Promise<EnsureWebhookSubscriptionResult> {
  const { clientId, clientSecret, callbackUrl, verifyToken } = params

  try {
    // Check for existing subscription
    const existing = await getSubscription(clientId, clientSecret)

    if (existing) {
      // Check if callback URL matches
      if (existing.callback_url === callbackUrl) {
        logger.info({
          message:
            'Strava webhook subscription already exists with correct URL',
          subscriptionId: existing.id
        })
        return { success: true, subscriptionId: existing.id }
      }

      // Delete mismatched subscription
      logger.info({
        message: 'Deleting mismatched Strava webhook subscription',
        subscriptionId: existing.id,
        existingUrl: existing.callback_url,
        newUrl: callbackUrl
      })
      await deleteSubscription(clientId, clientSecret, existing.id)
    }

    // Create new subscription
    logger.info({
      message: 'Creating new Strava webhook subscription',
      callbackUrl
    })
    const subscriptionId = await createSubscription(
      clientId,
      clientSecret,
      callbackUrl,
      verifyToken
    )

    logger.info({
      message: 'Strava webhook subscription created successfully',
      subscriptionId
    })

    return { success: true, subscriptionId }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown error occurred'
    return { success: false, error: message }
  }
}
