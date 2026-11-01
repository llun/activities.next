import { CLIENT_ERROR_MAX_LENGTHS } from '@/lib/utils/clientErrors/types'

import { ClientErrorSchema } from './schema'

const payload = {
  message: 'Error',
  pathname: '/',
  userAgent: 'Browser',
  buildVersion: 'unknown',
  source: 'error'
}

describe('client error metadata', () => {
  it.each([
    'unknown',
    '1.227.33',
    '1.2.3-beta.1+build-42',
    'digest-123',
    '1234567890',
    'aB_c.+-'
  ])('accepts %s as digest and build version', (value) => {
    expect(
      ClientErrorSchema.safeParse({
        ...payload,
        digest: value,
        buildVersion: value
      }).success
    ).toBe(true)
  })

  it.each(['digest', 'buildVersion'] as const)(
    'restricts %s to capped metadata identifiers',
    (field) => {
      for (const value of [
        '',
        'a b',
        'https://host/?token=secret',
        'a\nb',
        'a@b',
        'a'.repeat(CLIENT_ERROR_MAX_LENGTHS[field] + 1)
      ]) {
        expect(
          ClientErrorSchema.safeParse({ ...payload, [field]: value }).success,
          value
        ).toBe(false)
      }
      expect(
        ClientErrorSchema.safeParse({
          ...payload,
          [field]: 'a'.repeat(CLIENT_ERROR_MAX_LENGTHS[field])
        }).success
      ).toBe(true)
    }
  )
})
