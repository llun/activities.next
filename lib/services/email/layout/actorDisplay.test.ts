import { ActorProfile } from '@/lib/types/domain/actor'

import {
  getDisplayName,
  getInitials,
  getMonogramColor,
  getShortName,
  toQuoteAuthor
} from './actorDisplay'
import { MONOGRAM_PALETTE } from './theme'

const actor = (overrides: Partial<ActorProfile> = {}): ActorProfile => ({
  id: 'https://remote.example.com/users/ben',
  username: 'ben',
  domain: 'remote.example.com',
  followersUrl: 'https://remote.example.com/users/ben/followers',
  inboxUrl: 'https://remote.example.com/users/ben/inbox',
  sharedInboxUrl: 'https://remote.example.com/inbox',
  followingCount: 0,
  followersCount: 0,
  statusCount: 0,
  lastStatusAt: null,
  createdAt: 1000,
  ...overrides
})

describe('getDisplayName', () => {
  it.each([
    {
      description: 'uses the profile name when it is set',
      name: 'Ben Carter',
      expected: 'Ben Carter'
    },
    {
      description: 'falls back to the username when the name is missing',
      name: undefined,
      expected: 'ben'
    },
    {
      description: 'falls back to the username when the name is blank',
      name: '   ',
      expected: 'ben'
    },
    {
      description: 'trims surrounding whitespace from the name',
      name: '  Ben Carter  ',
      expected: 'Ben Carter'
    }
  ])('$description', ({ name, expected }) => {
    expect(getDisplayName(actor({ name }))).toBe(expected)
  })
})

describe('getShortName', () => {
  it.each([
    {
      description: 'takes the first word of a multi-word name',
      name: 'Ben Carter',
      expected: 'Ben'
    },
    {
      description: 'returns a single-word name unchanged',
      name: 'Maythee',
      expected: 'Maythee'
    },
    {
      description: 'collapses repeated spaces between words',
      name: 'Ben    Carter',
      expected: 'Ben'
    },
    {
      description: 'falls back to the username when the name is missing',
      name: undefined,
      expected: 'ben'
    }
  ])('$description', ({ name, expected }) => {
    expect(getShortName(actor({ name }))).toBe(expected)
  })
})

describe('getInitials', () => {
  it.each([
    {
      description: 'uses the first two characters of a single-word name',
      displayName: 'Maythee',
      expected: 'MA'
    },
    {
      description: 'uses the initials of the first two words',
      displayName: 'Ben Carter',
      expected: 'BC'
    },
    {
      description: 'ignores words after the second',
      displayName: 'Ben Michael Carter',
      expected: 'BM'
    },
    {
      description: 'uppercases a lowercase name',
      displayName: 'anna',
      expected: 'AN'
    },
    {
      description: 'returns a single character for a one-character name',
      displayName: 'A',
      expected: 'A'
    },
    {
      description: 'returns a placeholder for an empty name',
      displayName: '',
      expected: '?'
    },
    {
      description: 'returns a placeholder for a whitespace-only name',
      displayName: '   ',
      expected: '?'
    },
    {
      description: 'keeps a non-Latin character whole',
      displayName: 'ปกรณ์',
      expected: 'ปก'
    },
    {
      description: 'does not split an astral-plane character',
      displayName: '😀 Carter',
      expected: '😀C'
    }
  ])('$description', ({ displayName, expected }) => {
    expect(getInitials(displayName)).toBe(expected)
  })
})

describe('getMonogramColor', () => {
  it('returns a colour from the palette', () => {
    expect(MONOGRAM_PALETTE).toContain(getMonogramColor('@ben@example.com'))
  })

  it('returns the same colour for the same handle', () => {
    expect(getMonogramColor('@ben@example.com')).toBe(
      getMonogramColor('@ben@example.com')
    )
  })

  it('spreads different handles across more than one colour', () => {
    const colors = new Set(
      Array.from({ length: 40 }, (_, index) =>
        getMonogramColor(`@user${index}@example.com`)
      )
    )
    expect(colors.size).toBeGreaterThan(1)
  })
})

describe('toQuoteAuthor', () => {
  it('pairs the display name with the fully qualified handle', () => {
    expect(toQuoteAuthor(actor({ name: 'Ben Carter' }))).toEqual({
      displayName: 'Ben Carter',
      handle: '@ben@remote.example.com'
    })
  })
})
