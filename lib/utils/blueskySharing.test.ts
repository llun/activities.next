import {
  getBlueskyHandle,
  getBlueskyRequirements,
  getBlueskySharingStatus
} from './blueskySharing'

const profile = {
  username: 'alice',
  domain: 'personal.example',
  name: 'Alice Example',
  iconUrl: 'https://personal.example/alice.jpg'
}

describe('Bluesky sharing helpers', () => {
  it('derives the handle from this actor’s domain and replaces every underscore and tilde', () => {
    expect(
      getBlueskyHandle({
        username: 'Alice_one~two_3',
        domain: 'Personal.example'
      })
    ).toBe('alice-one-two-3.personal.example.ap.brid.gy')
  })

  it.each(['alice', 'a', 'a_b-c~d', 'ALICE9'])(
    'accepts bridgeable username %s',
    (username) => {
      expect(getBlueskyRequirements({ ...profile, username })).toEqual([])
    }
  )

  it.each([
    '_alice',
    'alice_',
    '-alice',
    'alice-',
    '~alice',
    'alice~',
    'ali.ce',
    'al`ice',
    'al{ice',
    'álîce',
    ''
  ])('rejects unbridgeable username %s', (username) => {
    expect(getBlueskyRequirements({ ...profile, username })).toEqual([
      expect.stringContaining('Your username')
    ])
  })

  it.each([undefined, '', ' ', 'ALICE', ' alice '])(
    'requires a distinct nonempty display name (%s)',
    (name) => {
      expect(getBlueskyRequirements({ ...profile, name })).toEqual([
        expect.stringContaining('display name')
      ])
    }
  )

  it.each([undefined, '', ' '])(
    'requires a profile picture (%s)',
    (iconUrl) => {
      expect(getBlueskyRequirements({ ...profile, iconUrl })).toEqual([
        'Add a profile picture.'
      ])
    }
  )

  it.each([
    [false, undefined, 'Off'],
    [false, 'Requested', 'Setting up'],
    [false, 'Accepted', 'On'],
    [false, 'Undo', 'Off'],
    [false, 'Rejected', 'Off'],
    [true, 'Accepted', 'Off'],
    [true, 'Requested', 'Off']
  ] as const)(
    'derives status from block=%s and follow=%s',
    (block, follow, expected) => {
      expect(getBlueskySharingStatus(block, follow)).toBe(expected)
    }
  )
})
