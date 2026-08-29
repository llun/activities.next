import { trace } from '@opentelemetry/api'

import { setupRecordingTracer } from '@/lib/testing/recordingTracer'

import {
  annotateAuthAnonymous,
  annotateAuthRejection,
  annotateAuthSuccess
} from './authTrace'

describe('authTrace', () => {
  let harness: ReturnType<typeof setupRecordingTracer>

  beforeEach(() => {
    harness = setupRecordingTracer()
  })

  afterEach(() => {
    harness.cleanup()
  })

  describe('annotateAuthRejection', () => {
    it('sets reject_reason and extra attributes on active recording span', async () => {
      await trace.getTracer('test').startActiveSpan('testRoute', async () => {
        annotateAuthRejection('token_expired', {
          auth_type: 'bearer',
          status: 401,
          required_scopes: ['read', 'write']
        })
      })

      expect(harness.recordedSpans).toHaveLength(1)
      expect(harness.recordedSpans[0].attributes).toMatchObject({
        'auth.reject_reason': 'token_expired',
        'auth.auth_type': 'bearer',
        'auth.status': 401,
        'auth.required_scopes': ['read', 'write']
      })
    })

    it('does not throw when no span is active', () => {
      expect(() => {
        annotateAuthRejection('token_expired')
      }).not.toThrow()
    })
  })

  describe('annotateAuthSuccess', () => {
    it('sets authentication success attributes on active recording span', async () => {
      await trace.getTracer('test').startActiveSpan('testRoute', async () => {
        annotateAuthSuccess({
          authType: 'bearer',
          actorId: 'https://llun.test/users/alice',
          clientId: 'client-123',
          userId: 'user-456',
          grantedScopes: ['read', 'write']
        })
      })

      expect(harness.recordedSpans).toHaveLength(1)
      expect(harness.recordedSpans[0].attributes).toMatchObject({
        'auth.authenticated': true,
        'auth.auth_type': 'bearer',
        'auth.actor_id': 'https://llun.test/users/alice',
        'auth.client_id': 'client-123',
        'auth.user_id': 'user-456',
        'auth.granted_scopes': 'read write'
      })
    })
  })

  describe('annotateAuthAnonymous', () => {
    it('sets anonymous auth attributes on active recording span', async () => {
      await trace.getTracer('test').startActiveSpan('testRoute', async () => {
        annotateAuthAnonymous({
          downgraded: true,
          reason: 'token_not_found'
        })
      })

      expect(harness.recordedSpans).toHaveLength(1)
      expect(harness.recordedSpans[0].attributes).toMatchObject({
        'auth.auth_type': 'anonymous',
        'auth.downgraded_from_invalid_token': true,
        'auth.token_reject_reason': 'token_not_found'
      })
    })
  })
})
