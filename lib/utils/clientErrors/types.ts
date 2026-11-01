// Shared by the client error reporter and the report endpoint, so it stays
// dependency-free: no React, no zod, no env, no logger.

export const CLIENT_ERRORS_PATH = '/api/v1/client-errors'

export const CLIENT_ERROR_MAX_LENGTHS = {
  name: 128,
  message: 1000,
  stack: 8000,
  digest: 128,
  pathname: 2048,
  userAgent: 500,
  buildVersion: 64
} as const

export const CLIENT_ERROR_SOURCES = [
  'global-error',
  'error',
  'chunk-load'
] as const

export type ClientErrorSource = (typeof CLIENT_ERROR_SOURCES)[number]

export interface ClientErrorPayload {
  name?: string
  message: string
  stack?: string
  digest?: string
  pathname: string
  userAgent: string
  buildVersion: string
  source: ClientErrorSource
}
