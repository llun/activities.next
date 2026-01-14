/**
 * Test utilities for Next.js API route handlers
 * Provides helpers for mocking requests, auth, and database
 */
import { NextRequest } from 'next/server'

import { Database } from '@/lib/database/types'
import { Actor } from '@/lib/models/actor'

/**
 * Creates a mock NextRequest with the specified options
 */
export function createMockRequest(
  url: string,
  options: {
    method?: string
    headers?: Record<string, string>
    body?: object | string
  } = {}
): NextRequest {
  const { method = 'GET', headers = {}, body } = options

  const headersObj = new Headers(headers)

  if (body && typeof body !== 'string') {
    headersObj.set('Content-Type', 'application/json')
  }

  return new NextRequest(url, {
    method,
    headers: headersObj,
    body: body
      ? typeof body === 'string'
        ? body
        : JSON.stringify(body)
      : undefined
  })
}

/**
 * Creates mock route context with params
 */
export function createMockContext<P extends Record<string, string>>(
  params: P
): { params: Promise<P> } {
  return {
    params: Promise.resolve(params)
  }
}

/**
 * Creates a mock authenticated context for OAuthGuard handlers
 */
export function createAuthenticatedContext<P extends Record<string, string>>(
  database: Database,
  currentActor: Actor,
  params: P
): {
  database: Database
  currentActor: Actor
  params: Promise<P>
} {
  return {
    database,
    currentActor,
    params: Promise.resolve(params)
  }
}

/**
 * Extracts JSON response body from NextResponse
 */
export async function getResponseJson<T = unknown>(
  response: Response
): Promise<T> {
  return response.json() as Promise<T>
}

/**
 * Asserts response status and returns JSON body
 */
export async function expectJsonResponse<T = unknown>(
  response: Response,
  expectedStatus: number
): Promise<T> {
  if (response.status !== expectedStatus) {
    const text = await response.text()
    throw new Error(
      `Expected status ${expectedStatus} but got ${response.status}: ${text}`
    )
  }
  return response.json() as Promise<T>
}
