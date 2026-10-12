import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { vi } from 'vitest'

import type { OAuthAccessTokenRecord } from '@/lib/database/domains/oauth/types'
import type { Database } from '@/lib/database/types'

// What a guard suite seeds for a bearer token: the fields of the access-token
// row the guard reads, `expiresAt` in epoch milliseconds. A field a test leaves
// out reads back as undefined, like a column the fixture never set.
export type StoredTokenSeed = Partial<OAuthAccessTokenRecord>

// Makes `database.getOAuthAccessTokenByHash` answer from `lookup`, which gets
// the hashed bearer token and returns the row to find. A token `lookup` has no
// row for is looked up in the real table, which is empty unless the test
// inserted a row itself. Everything else on `database` stays real.
export const stubAccessTokenLookup = (
  database: Database,
  lookup: (hashedToken: string) => StoredTokenSeed | null | undefined
) => {
  const realLookup = database.getOAuthAccessTokenByHash.bind(database)
  return vi
    .spyOn(database, 'getOAuthAccessTokenByHash')
    .mockImplementation(async (params) => {
      const row = lookup(params.hashedToken)
      return row ? (row as OAuthAccessTokenRecord) : realLookup(params)
    })
}

// A suite that seeds the stored rows hashes the bearer token the same way the
// guard does.
export const hashToken = (token: string) =>
  crypto
    .createHash('sha256')
    .update(token)
    .digest()
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

export const createRequest = (
  headers: Record<string, string> = {},
  method = 'GET',
  url = 'https://llun.test/api/test'
) => {
  return new NextRequest(url, {
    method,
    headers
  })
}

export const mockHandler = vi.fn().mockImplementation(() => {
  return NextResponse.json({ success: true }, { status: 200 })
})
