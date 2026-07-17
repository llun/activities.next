import { canCreateSessionForAccount } from './canCreateSessionForAccount'

describe('canCreateSessionForAccount', () => {
  it.each([
    {
      description: 'rejects an unverified account',
      account: { verifiedAt: null, approvedAt: 1, disabledAt: null },
      expected: false
    },
    {
      description: 'rejects a disabled account',
      account: { verifiedAt: 1, approvedAt: 1, disabledAt: 1 },
      expected: false
    },
    {
      description: 'rejects a registration-pending account',
      account: { verifiedAt: 1, approvedAt: null, disabledAt: null },
      expected: false
    },
    {
      description: 'allows a verified, approved, enabled account',
      account: { verifiedAt: 1, approvedAt: 1, disabledAt: null },
      expected: true
    }
  ])('$description', ({ account, expected }) => {
    expect(canCreateSessionForAccount(account)).toBe(expected)
  })
})
