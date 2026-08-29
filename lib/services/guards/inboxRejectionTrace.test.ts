import { trace } from '@opentelemetry/api'

import { setupRecordingTracer } from '@/lib/testing/recordingTracer'

import {
  annotateInboxRejection,
  getActivityTraceAttributes
} from './inboxRejectionTrace'

describe('inboxRejectionTrace', () => {
  let harness: ReturnType<typeof setupRecordingTracer>

  beforeEach(() => {
    harness = setupRecordingTracer()
  })

  afterEach(() => {
    harness.cleanup()
  })

  describe('getActivityTraceAttributes', () => {
    it('returns empty object for non-record bodies', () => {
      expect(getActivityTraceAttributes(null)).toEqual({})
      expect(getActivityTraceAttributes(undefined)).toEqual({})
      expect(getActivityTraceAttributes('string')).toEqual({})
      expect(getActivityTraceAttributes(123)).toEqual({})
      expect(getActivityTraceAttributes([])).toEqual({})
    })

    it('extracts activity metadata for a standard Create activity with nested object', () => {
      const body = {
        id: 'https://writing.exchange/users/ninetiger/statuses/12345/activity',
        type: 'Create',
        actor: 'https://writing.exchange/users/ninetiger',
        object: {
          id: 'https://writing.exchange/users/ninetiger/statuses/12345',
          type: 'Note'
        }
      }

      expect(getActivityTraceAttributes(body)).toEqual({
        activity_id:
          'https://writing.exchange/users/ninetiger/statuses/12345/activity',
        activity_type: 'Create',
        activity_actor: 'https://writing.exchange/users/ninetiger',
        activity_object_id:
          'https://writing.exchange/users/ninetiger/statuses/12345',
        activity_object_type: 'Note',
        activity_target_id: undefined
      })
    })

    it('extracts string object URI for Delete or Announce activities', () => {
      const body = {
        id: 'https://remote.test/users/alice/activities/delete-1',
        type: 'Delete',
        actor: 'https://remote.test/users/alice',
        object: 'https://remote.test/users/alice/statuses/1'
      }

      expect(getActivityTraceAttributes(body)).toEqual({
        activity_id: 'https://remote.test/users/alice/activities/delete-1',
        activity_type: 'Delete',
        activity_actor: 'https://remote.test/users/alice',
        activity_object_id: 'https://remote.test/users/alice/statuses/1',
        activity_object_type: undefined,
        activity_target_id: undefined
      })
    })

    it('extracts target and array types correctly', () => {
      const body = {
        id: 'https://remote.test/users/alice/activities/add-1',
        type: ['Add', 'CustomActivity'],
        actor: { id: 'https://remote.test/users/alice' },
        object: {
          id: 'https://remote.test/users/alice/statuses/1',
          type: ['Note', 'Article']
        },
        target: 'https://remote.test/users/alice/collections/featured'
      }

      expect(getActivityTraceAttributes(body)).toEqual({
        activity_id: 'https://remote.test/users/alice/activities/add-1',
        activity_type: 'Add,CustomActivity',
        activity_actor: 'https://remote.test/users/alice',
        activity_object_id: 'https://remote.test/users/alice/statuses/1',
        activity_object_type: 'Note,Article',
        activity_target_id:
          'https://remote.test/users/alice/collections/featured'
      })
    })

    it('extracts target when target is an object with id', () => {
      const body = {
        id: 'https://remote.test/users/alice/activities/1',
        type: 'Follow',
        actor: 'https://remote.test/users/alice',
        object: 'https://local.test/users/bob',
        target: { id: 'https://local.test/users/bob/inbox' }
      }

      expect(getActivityTraceAttributes(body)).toEqual({
        activity_id: 'https://remote.test/users/alice/activities/1',
        activity_type: 'Follow',
        activity_actor: 'https://remote.test/users/alice',
        activity_object_id: 'https://local.test/users/bob',
        activity_object_type: undefined,
        activity_target_id: 'https://local.test/users/bob/inbox'
      })
    })
  })

  describe('annotateInboxRejection', () => {
    it('sets reject_reason and extra attributes on the active recording span', async () => {
      await trace
        .getTracer('test')
        .startActiveSpan('api.sharedInbox', async () => {
          annotateInboxRejection('sender_actor_mismatch', {
            verified_sender: 'https://mstdn.social/users/grickle',
            ...getActivityTraceAttributes({
              id: 'https://writing.exchange/users/ninetiger/statuses/123/activity',
              type: 'Create',
              actor: 'https://writing.exchange/users/ninetiger',
              object: {
                id: 'https://writing.exchange/users/ninetiger/statuses/123',
                type: 'Note'
              }
            })
          })
        })

      expect(harness.recordedSpans).toHaveLength(1)
      expect(harness.recordedSpans[0].attributes).toMatchObject({
        'inbox.reject_reason': 'sender_actor_mismatch',
        'inbox.verified_sender': 'https://mstdn.social/users/grickle',
        'inbox.activity_id':
          'https://writing.exchange/users/ninetiger/statuses/123/activity',
        'inbox.activity_type': 'Create',
        'inbox.activity_actor': 'https://writing.exchange/users/ninetiger',
        'inbox.activity_object_id':
          'https://writing.exchange/users/ninetiger/statuses/123',
        'inbox.activity_object_type': 'Note'
      })
    })
  })
})
