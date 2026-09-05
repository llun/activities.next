export enum DeliveryDisposition {
  SALVAGEABLE = 'salvageable',
  UNSALVAGEABLE = 'unsalvageable'
}

export const SALVAGEABLE_STATUS_CODES = new Set([
  401, 408, 429, 500, 502, 503, 504
])

export const SALVAGEABLE_NETWORK_ERROR_CODES = new Set([
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT'
])

export const isSalvageableStatusCode = (statusCode: number): boolean => {
  if (statusCode === 501) return false
  if (statusCode >= 500 && statusCode < 600) return true
  return SALVAGEABLE_STATUS_CODES.has(statusCode)
}

export const isSalvageableNetworkError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false
  const code = (error as { code?: string }).code
  if (!code) return false
  return SALVAGEABLE_NETWORK_ERROR_CODES.has(code)
}

export interface ClassifyDeliveryErrorParams {
  statusCode?: number
  error?: unknown
}

export interface ClassifiedDeliveryResult {
  disposition: DeliveryDisposition
  reason: string
}

export class SalvageableDeliveryError extends Error {
  readonly statusCode?: number
  readonly originalError?: unknown

  constructor(
    message: string,
    options?: { statusCode?: number; originalError?: unknown }
  ) {
    super(message)
    this.name = 'SalvageableDeliveryError'
    this.statusCode = options?.statusCode
    this.originalError = options?.originalError
  }
}

export const classifyDeliveryError = ({
  statusCode,
  error
}: ClassifyDeliveryErrorParams): ClassifiedDeliveryResult => {
  if (statusCode !== undefined) {
    if (isSalvageableStatusCode(statusCode)) {
      return {
        disposition: DeliveryDisposition.SALVAGEABLE,
        reason: `HTTP ${statusCode} is transient/salvageable`
      }
    }
    return {
      disposition: DeliveryDisposition.UNSALVAGEABLE,
      reason: `HTTP ${statusCode} is permanent/unsalvageable`
    }
  }

  if (isSalvageableNetworkError(error)) {
    const code = (error as { code?: string }).code
    return {
      disposition: DeliveryDisposition.SALVAGEABLE,
      reason: `Network error ${code} is transient/salvageable`
    }
  }

  return {
    disposition: DeliveryDisposition.UNSALVAGEABLE,
    reason: 'Unrecognized error'
  }
}
