import { hasFederatedProfileChange } from '@/lib/services/actors/hasFederatedProfileChange'
import { MockActor } from '@/lib/stub/actor'
import { Actor } from '@/lib/types/domain/actor'
import * as personModule from '@/lib/utils/getPersonFromActor'

const base = (): Actor => ({
  ...MockActor({}),
  name: 'Alice',
  summary: 'Hello',
  iconUrl: 'https://chat.llun.dev/api/v1/files/icon.jpg',
  fields: [{ name: 'Blog', value: 'https://blog.example' }],
  createdAt: 500,
  updatedAt: 1000
})

describe('hasFederatedProfileChange', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('is false for an identical actor', () => {
    expect(hasFederatedProfileChange(base(), base())).toBe(false)
  })

  it.each<{ description: string; change: Partial<Actor> }>([
    { description: 'the name', change: { name: 'Alice B' } },
    { description: 'the summary', change: { summary: 'New bio' } },
    {
      description: 'the avatar',
      change: { iconUrl: 'https://chat.llun.dev/api/v1/files/other.jpg' }
    },
    { description: 'removing the avatar', change: { iconUrl: undefined } },
    {
      description: 'the header',
      change: { headerImageUrl: 'https://chat.llun.dev/api/v1/files/h.jpg' }
    },
    {
      description: 'a profile link value',
      change: { fields: [{ name: 'Blog', value: 'https://new.example' }] }
    },
    {
      description: 'a profile link label',
      change: { fields: [{ name: 'Site', value: 'https://blog.example' }] }
    },
    { description: 'removing the links', change: { fields: [] } },
    {
      description: 'locking the account',
      change: { manuallyApprovesFollowers: true }
    },
    { description: 'discoverable', change: { discoverable: true } },
    { description: 'indexable', change: { indexable: true } },
    {
      description: 'attribution domains',
      change: { attributionDomains: ['news.example.com'] }
    },
    {
      description: 'the emoji tags',
      change: {
        tags: [
          {
            type: 'emoji',
            name: ':blobcat:',
            value: 'https://chat.llun.dev/emojis/blobcat.png'
          }
        ]
      }
    }
  ])('is true when $description changes', ({ change }) => {
    expect(hasFederatedProfileChange(base(), { ...base(), ...change })).toBe(
      true
    )
  })

  it('ignores a link verification stamp, which is never federated', () => {
    const after = {
      ...base(),
      fields: [
        { name: 'Blog', value: 'https://blog.example', verifiedAt: 5000 }
      ],
      linksCheckedAt: 5000
    }
    expect(hasFederatedProfileChange(base(), after)).toBe(false)
  })

  it('ignores settings remote servers never see', () => {
    const after = {
      ...base(),
      readingExpandMedia: 'show_all' as const,
      readingAutoplayGifs: true
    }
    expect(hasFederatedProfileChange(base(), after)).toBe(false)
  })

  it('ignores updatedAt, which moves on every save and stamps emoji tags', () => {
    const tags = [
      {
        type: 'emoji' as const,
        name: ':blobcat:',
        value: 'https://chat.llun.dev/emojis/blobcat.png'
      }
    ]
    const before = { ...base(), tags }
    const after = { ...before, updatedAt: 99999 }
    expect(hasFederatedProfileChange(before, after)).toBe(false)
  })

  it('counts moved-to and aliases, which the local Person carries', () => {
    const moved = { ...base(), movedTo: 'https://other.example/users/me' }
    const aliased = {
      ...base(),
      alsoKnownAs: ['https://other.example/users/me']
    }
    expect(hasFederatedProfileChange(base(), moved)).toBe(true)
    expect(hasFederatedProfileChange(base(), aliased)).toBe(true)
  })

  it('treats an empty name and an absent one as the same document', () => {
    const before = { ...base(), name: undefined }
    const after = { ...base(), name: '' }
    expect(hasFederatedProfileChange(before, after)).toBe(false)
  })

  it('answers true when the comparison itself fails', () => {
    vi.spyOn(personModule, 'getPersonFromActor').mockImplementation(() => {
      throw new Error('cannot render')
    })
    expect(hasFederatedProfileChange(base(), base())).toBe(true)
  })
})
