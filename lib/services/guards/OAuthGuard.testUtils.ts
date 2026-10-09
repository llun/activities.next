import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { vi } from 'vitest'

// mockStoredTokens maps hashed tokens to their stored records; the suites that
// seed it hash the bearer token the same way the guard does.
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
