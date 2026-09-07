import { describe, expect, it } from 'vitest'

import { ActorProfile } from '@/lib/types/domain/actor'
import { Status, StatusType } from '@/lib/types/domain/status'

import {
  getQuotePrefix,
  getQuotePrefixRegex,
  getQuoteUrl,
  stripQuotePrefix
} from './composerQuote'

describe('composerQuote', () => {
  const host = 'activities.local'
  const actor = {
    id: 'https://activities.local/users/bob',
    username: 'bob',
    domain: 'activities.local',
    name: 'Bob',
    summary: '',
    type: 'Person',
    createdAt: Date.now(),
    updatedAt: Date.now()
  } as unknown as ActorProfile

  describe('getQuoteUrl', () => {
    it('prefers original.url when it is already a full absolute web URL', () => {
      const status = {
        id: 'https://activities.local/users/bob/statuses/1',
        url: 'https://activities.local/@bob/1',
        actor,
        type: StatusType.enum.Note
      } as unknown as Status
      expect(getQuoteUrl(status, host)).toBe('https://activities.local/@bob/1')
    })

    it('constructs canonical URL with publicId when original.publicId is present', () => {
      const publicId = '01956621-4506-76f6-8653-d4233375fe51'
      const status = {
        id: 'https://activities.local/users/bob/statuses/internal-id',
        publicId,
        actor,
        type: StatusType.enum.Note
      } as unknown as Status
      expect(getQuoteUrl(status, host)).toBe(
        `https://activities.local/@bob@activities.local/${publicId}`
      )
    })

    it('constructs canonical URL when status id is a bare UUIDv7 publicId', () => {
      const publicId = '01956621-4506-76f6-8653-d4233375fe51'
      const status = {
        id: publicId,
        actor,
        type: StatusType.enum.Note
      } as unknown as Status
      expect(getQuoteUrl(status, host)).toBe(
        `https://activities.local/@bob@activities.local/${publicId}`
      )
    })

    it('constructs canonical URL when status id ends with a UUIDv7 publicId', () => {
      const publicId = '01956621-4506-76f6-8653-d4233375fe51'
      const status = {
        id: `https://activities.local/users/bob/statuses/${publicId}`,
        actor,
        type: StatusType.enum.Note
      } as unknown as Status
      expect(getQuoteUrl(status, host)).toBe(
        `https://activities.local/@bob@activities.local/${publicId}`
      )
    })

    it('resolves relative path in url against host', () => {
      const status = {
        id: 'https://activities.local/users/bob/statuses/1',
        url: '/@bob/1',
        actor,
        type: StatusType.enum.Note
      } as unknown as Status
      expect(getQuoteUrl(status, host)).toBe('https://activities.local/@bob/1')
    })

    it('handles host with explicit https:// prefix and trailing slashes', () => {
      const status = {
        id: 'https://activities.local/users/bob/statuses/1',
        url: '/@bob/1',
        actor,
        type: StatusType.enum.Note
      } as unknown as Status
      expect(getQuoteUrl(status, 'https://activities.local/')).toBe(
        'https://activities.local/@bob/1'
      )
    })

    it('encodes remote actor status id when isLocalActor is false', () => {
      const remoteActor: ActorProfile = {
        ...actor,
        username: 'charlie',
        domain: 'remote.social',
        name: 'Charlie'
      }
      const status = {
        id: 'https://remote.social/statuses/999',
        actor: remoteActor,
        isLocalActor: false,
        type: StatusType.enum.Note
      } as unknown as Status
      expect(getQuoteUrl(status, host)).toBe(
        `https://activities.local/@charlie@remote.social/${encodeURIComponent('https://remote.social/statuses/999')}`
      )
    })

    it('returns remote status url when it is a full web URL not containing /users/', () => {
      const remoteActor: ActorProfile = {
        ...actor,
        username: 'charlie',
        domain: 'remote.social',
        name: 'Charlie'
      }
      const status = {
        id: 'https://remote.social/users/charlie/statuses/999',
        url: 'https://remote.social/@charlie/999',
        actor: remoteActor,
        isLocalActor: false,
        type: StatusType.enum.Note
      } as unknown as Status
      expect(getQuoteUrl(status, host)).toBe(
        'https://remote.social/@charlie/999'
      )
    })

    it('resolves relative path in id against host', () => {
      const status = {
        id: '/statuses/relative-id',
        type: StatusType.enum.Note
      } as unknown as Status
      expect(getQuoteUrl(status, host)).toBe(
        'https://activities.local/statuses/relative-id'
      )
    })

    it('falls back to /statuses/:id when actor is missing', () => {
      const status = {
        id: '01956621-4506-76f6-8653-d4233375fe51',
        type: StatusType.enum.Note
      } as unknown as Status
      expect(getQuoteUrl(status, host)).toBe(
        'https://activities.local/statuses/01956621-4506-76f6-8653-d4233375fe51'
      )
    })

    it('falls back to host when id and url are empty', () => {
      const status = {
        id: '',
        url: '',
        type: StatusType.enum.Note
      } as unknown as Status
      expect(getQuoteUrl(status, host)).toBe('https://activities.local')
    })
  })

  describe('getQuotePrefix', () => {
    it('returns empty string from getQuotePrefix when quotedStatus is undefined', () => {
      expect(getQuotePrefix(undefined, host)).toBe('')
    })

    it('formats quote prefix with RE: and trailing double newline', () => {
      const status = {
        id: 'https://activities.local/users/bob/statuses/1',
        url: 'https://activities.local/@bob/1',
        actor,
        type: StatusType.enum.Note
      } as unknown as Status
      expect(getQuotePrefix(status, host)).toBe(
        'RE: https://activities.local/@bob/1\n\n'
      )
    })
  })

  describe('getQuotePrefixRegex & stripQuotePrefix', () => {
    it('creates regex matching quote url and original URLs', () => {
      const status = {
        id: 'https://activities.local/users/bob/statuses/1',
        url: 'https://activities.local/@bob/1',
        actor,
        type: StatusType.enum.Note
      } as unknown as Status
      const regex = getQuotePrefixRegex(status, host)
      expect(regex.test('RE: https://activities.local/@bob/1\n\n')).toBe(true)
    })

    it('strips matching quote prefix and trailing whitespace', () => {
      const status = {
        id: 'https://activities.local/users/bob/statuses/1',
        url: 'https://activities.local/@bob/1',
        actor,
        type: StatusType.enum.Note
      } as unknown as Status
      const text = 'RE: https://activities.local/@bob/1\n\nMy reply comment'
      expect(stripQuotePrefix(text, status, host)).toBe('My reply comment')
    })

    it('leaves text untouched when prefix does not match', () => {
      const status = {
        id: 'https://activities.local/users/bob/statuses/1',
        url: 'https://activities.local/@bob/1',
        actor,
        type: StatusType.enum.Note
      } as unknown as Status
      const text = 'Just some thoughts without any quote prefix'
      expect(stripQuotePrefix(text, status, host)).toBe(text)
    })
  })
})
