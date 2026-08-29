import pino from 'pino'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { VERSION } from '@/lib/utils/version'

describe('logger configuration and GCP formatters', () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.resetModules()
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
    vi.resetModules()
  })

  it('configures serviceContext with Cloud Run environment variables when present', async () => {
    process.env.K_SERVICE = 'my-cloudrun-service'
    process.env.K_REVISION = 'my-cloudrun-service-00001-abc'

    const { logger } = await import('@/lib/utils/logger')
    const bindings = logger.bindings() as {
      serviceContext?: { service: string; version: string }
    }

    expect(bindings.serviceContext?.service).toBe('my-cloudrun-service')
    expect(bindings.serviceContext?.version).toBe(
      'my-cloudrun-service-00001-abc'
    )
  })

  it('falls back to default service name and version when Cloud Run variables are unset', async () => {
    delete process.env.K_SERVICE
    delete process.env.K_REVISION

    const { logger } = await import('@/lib/utils/logger')
    const bindings = logger.bindings() as {
      serviceContext?: { service: string; version: string }
    }

    expect(bindings.serviceContext?.service).toBe('activities.next')
    expect(bindings.serviceContext?.version).toBe(VERSION)
  })

  it('formats severity and Error Reporting type when running in GCP', async () => {
    process.env.K_SERVICE = 'test-service'
    const logs: string[] = []

    const { getLoggerOptions } = await import('@/lib/utils/logger')
    const destination = {
      write(chunk: string) {
        logs.push(chunk)
      }
    }
    const testLogger = pino(getLoggerOptions(), destination)

    testLogger.warn('A warning message')
    const warnEntry = JSON.parse(logs[0])
    expect(warnEntry.severity).toBe('WARNING')
    expect(warnEntry['@type']).toBeUndefined()

    testLogger.error(new Error('An error occurred'), 'Operation failed')
    const errorEntry = JSON.parse(logs[1])
    expect(errorEntry.severity).toBe('ERROR')
    expect(errorEntry['@type']).toBe(
      'type.googleapis.com/google.devtools.clouderrorreporting.v1beta1.ReportedErrorEvent'
    )
    expect(errorEntry.stack_trace).toBeDefined()
  })

  it('extracts stack_trace from err, error, and direct stack properties', async () => {
    process.env.K_SERVICE = 'test-service'
    const logs: string[] = []

    const { getLoggerOptions } = await import('@/lib/utils/logger')
    const destination = {
      write(chunk: string) {
        logs.push(chunk)
      }
    }
    const testLogger = pino(getLoggerOptions(), destination)

    const testError = new Error('Test failure')

    testLogger.error({ err: testError, message: 'Failed with err' })
    const entryWithErr = JSON.parse(logs[0])
    expect(entryWithErr.stack_trace).toBe(testError.stack)

    testLogger.error({ error: testError, message: 'Failed with error' })
    const entryWithError = JSON.parse(logs[1])
    expect(entryWithError.stack_trace).toBe(testError.stack)

    testLogger.error({
      stack: 'custom-stack-trace',
      message: 'Failed with stack'
    })
    const entryWithStack = JSON.parse(logs[2])
    expect(entryWithStack.stack_trace).toBe('custom-stack-trace')
  })
})
