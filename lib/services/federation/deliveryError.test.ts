import { describe, expect, it } from 'vitest'

import {
  DeliveryDisposition,
  SalvageableDeliveryError,
  classifyDeliveryError,
  isSalvageableNetworkError,
  isSalvageableStatusCode
} from './deliveryError'

describe('deliveryError', () => {
  describe('isSalvageableStatusCode', () => {
    it('treats 5xx server errors as salvageable', () => {
      expect(isSalvageableStatusCode(500)).toBe(true)
      expect(isSalvageableStatusCode(502)).toBe(true)
      expect(isSalvageableStatusCode(503)).toBe(true)
      expect(isSalvageableStatusCode(504)).toBe(true)
    })

    it('treats transient 4xx codes (401, 408, 429) as salvageable', () => {
      expect(isSalvageableStatusCode(401)).toBe(true)
      expect(isSalvageableStatusCode(408)).toBe(true)
      expect(isSalvageableStatusCode(429)).toBe(true)
    })

    it('treats permanent client errors (400, 403, 404, 410, 422) as unsalvageable', () => {
      expect(isSalvageableStatusCode(400)).toBe(false)
      expect(isSalvageableStatusCode(403)).toBe(false)
      expect(isSalvageableStatusCode(404)).toBe(false)
      expect(isSalvageableStatusCode(410)).toBe(false)
      expect(isSalvageableStatusCode(422)).toBe(false)
    })

    it('treats 501 Not Implemented as unsalvageable', () => {
      expect(isSalvageableStatusCode(501)).toBe(false)
    })
  })

  describe('isSalvageableNetworkError', () => {
    it('identifies transient network codes as salvageable', () => {
      expect(isSalvageableNetworkError({ code: 'ETIMEDOUT' })).toBe(true)
      expect(isSalvageableNetworkError({ code: 'ECONNRESET' })).toBe(true)
      expect(isSalvageableNetworkError({ code: 'ECONNREFUSED' })).toBe(true)
      expect(isSalvageableNetworkError({ code: 'ENOTFOUND' })).toBe(true)
      expect(isSalvageableNetworkError({ code: 'EAI_AGAIN' })).toBe(true)
    })

    it('returns false for non-network errors', () => {
      expect(isSalvageableNetworkError(new Error('Random syntax error'))).toBe(
        false
      )
      expect(isSalvageableNetworkError(null)).toBe(false)
      expect(isSalvageableNetworkError(undefined)).toBe(false)
    })
  })

  describe('classifyDeliveryError', () => {
    it('returns SALVAGEABLE for 503 response', () => {
      const result = classifyDeliveryError({ statusCode: 503 })
      expect(result.disposition).toBe(DeliveryDisposition.SALVAGEABLE)
    })

    it('returns UNSALVAGEABLE for 404 response', () => {
      const result = classifyDeliveryError({ statusCode: 404 })
      expect(result.disposition).toBe(DeliveryDisposition.UNSALVAGEABLE)
    })

    it('returns SALVAGEABLE for network timeout', () => {
      const result = classifyDeliveryError({
        error: { code: 'ETIMEDOUT', message: 'timeout' }
      })
      expect(result.disposition).toBe(DeliveryDisposition.SALVAGEABLE)
    })

    it('returns UNSALVAGEABLE for unrecognized error without code', () => {
      const result = classifyDeliveryError({
        error: new Error('Unknown error')
      })
      expect(result.disposition).toBe(DeliveryDisposition.UNSALVAGEABLE)
    })
  })

  describe('SalvageableDeliveryError', () => {
    it('constructs with statusCode and originalError', () => {
      const orig = new Error('root cause')
      const err = new SalvageableDeliveryError('Delivery failed', {
        statusCode: 503,
        originalError: orig
      })
      expect(err.name).toBe('SalvageableDeliveryError')
      expect(err.message).toBe('Delivery failed')
      expect(err.statusCode).toBe(503)
      expect(err.originalError).toBe(orig)
    })
  })
})
