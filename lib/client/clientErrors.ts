import {
  CLIENT_ERRORS_PATH,
  CLIENT_ERROR_MAX_LENGTHS,
  type ClientErrorPayload,
  type ClientErrorSource
} from '@/lib/utils/clientErrors/types'

const MAX_REPORTS_PER_PAGE_LOAD = 10
const reportedKeys = new Set<string>()
let reportCount = 0

const extractErrorInfo = (error: unknown) => {
  if (error instanceof Error) {
    return {
      name: error.name || 'Error',
      message: error.message || String(error),
      stack: error.stack,
      digest: (error as { digest?: string }).digest
    }
  }
  if (error && typeof error === 'object') {
    const value = error as Record<string, unknown>
    return {
      name: typeof value.name === 'string' ? value.name : 'Error',
      message:
        typeof value.message === 'string'
          ? value.message
          : 'Non-Error object thrown',
      stack: typeof value.stack === 'string' ? value.stack : undefined,
      digest: typeof value.digest === 'string' ? value.digest : undefined
    }
  }
  return {
    name: 'Error',
    message: typeof error === 'string' ? error : String(error)
  }
}

/**
 * Reports a client-side error to the server. Uses sendBeacon with a JSON blob,
 * falling back to keepalive fetch. Fire-and-forget, never throws.
 */
export const reportClientError = (
  error: unknown,
  source: ClientErrorSource
): void => {
  try {
    const { name, message, stack, digest } = extractErrorInfo(error)

    // Deduplicate per page load using source-independent name|message|digest
    const dedupeKey = `${name}|${message}|${digest ?? ''}`
    if (reportedKeys.has(dedupeKey)) {
      return
    }

    if (reportCount >= MAX_REPORTS_PER_PAGE_LOAD) {
      return
    }

    reportedKeys.add(dedupeKey)
    reportCount += 1

    let pathname = '/'
    if (typeof window !== 'undefined' && window.location?.pathname) {
      pathname = window.location.pathname
    }

    let userAgent = ''
    if (
      typeof navigator !== 'undefined' &&
      typeof navigator.userAgent === 'string'
    ) {
      userAgent = navigator.userAgent
    }

    const buildVersion = process.env.NEXT_PUBLIC_BUILD_VERSION || 'unknown'

    const payload: ClientErrorPayload = {
      name: name.slice(0, CLIENT_ERROR_MAX_LENGTHS.name),
      message: message.slice(0, CLIENT_ERROR_MAX_LENGTHS.message),
      stack: stack ? stack.slice(0, CLIENT_ERROR_MAX_LENGTHS.stack) : undefined,
      digest: digest
        ? digest.slice(0, CLIENT_ERROR_MAX_LENGTHS.digest)
        : undefined,
      pathname: pathname.slice(0, CLIENT_ERROR_MAX_LENGTHS.pathname),
      userAgent: userAgent.slice(0, CLIENT_ERROR_MAX_LENGTHS.userAgent),
      buildVersion: buildVersion.slice(
        0,
        CLIENT_ERROR_MAX_LENGTHS.buildVersion
      ),
      source
    }

    const body = JSON.stringify(payload)

    if (
      typeof navigator !== 'undefined' &&
      typeof navigator.sendBeacon === 'function' &&
      typeof Blob !== 'undefined' &&
      navigator.sendBeacon(
        CLIENT_ERRORS_PATH,
        new Blob([body], { type: 'application/json' })
      )
    ) {
      return
    }

    if (typeof fetch === 'function') {
      fetch(CLIENT_ERRORS_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        credentials: 'omit',
        keepalive: true
      }).catch(() => {})
    }
  } catch {
    // Telemetry must never crash the client: swallow all errors
  }
}
