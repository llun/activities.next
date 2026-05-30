import { hasGrantedScope } from './scopeHierarchy'

describe('hasGrantedScope', () => {
  it('matches an exact scope', () => {
    expect(hasGrantedScope(['read:statuses'], 'read:statuses')).toBe(true)
    expect(hasGrantedScope(['read'], 'read')).toBe(true)
  })

  describe('coarse → granular (a coarse grant satisfies its children)', () => {
    it('lets read satisfy any read:* requirement', () => {
      expect(hasGrantedScope(['read'], 'read:notifications')).toBe(true)
      expect(hasGrantedScope(['read'], 'read:statuses')).toBe(true)
    })

    it('lets write satisfy any write:* requirement', () => {
      expect(hasGrantedScope(['write'], 'write:statuses')).toBe(true)
    })

    it('lets admin:read satisfy granular admin:read:* requirements', () => {
      expect(hasGrantedScope(['admin:read'], 'admin:read:domain_blocks')).toBe(
        true
      )
    })

    it('lets admin:write satisfy granular admin:write:* requirements', () => {
      expect(hasGrantedScope(['admin:write'], 'admin:write:reports')).toBe(true)
    })
  })

  describe('granular → coarse (a granular grant satisfies its coarse family)', () => {
    it('lets a read:* token satisfy a route requiring coarse read', () => {
      // The key compatibility fix: granular-only tokens must not 401 on a route
      // guarded with the coarse scope.
      expect(hasGrantedScope(['read:notifications'], 'read')).toBe(true)
      expect(hasGrantedScope(['read:statuses'], 'read')).toBe(true)
    })

    it('lets a write:* token satisfy a route requiring coarse write', () => {
      expect(hasGrantedScope(['write:statuses'], 'write')).toBe(true)
    })

    it('lets a granular admin token satisfy the aggregate admin scope', () => {
      expect(hasGrantedScope(['admin:read:domain_blocks'], 'admin:read')).toBe(
        true
      )
    })
  })

  describe('family isolation (one family never reaches another)', () => {
    it('does not let read satisfy write', () => {
      expect(hasGrantedScope(['read', 'read:statuses'], 'write')).toBe(false)
    })

    it('does not let a read:* token satisfy write', () => {
      expect(hasGrantedScope(['read:statuses'], 'write:statuses')).toBe(false)
    })

    it('does not let coarse read satisfy admin:read', () => {
      expect(hasGrantedScope(['read'], 'admin:read')).toBe(false)
    })

    it('does not let coarse read satisfy a granular admin scope', () => {
      expect(hasGrantedScope(['read'], 'admin:read:domain_blocks')).toBe(false)
    })

    it('does not let admin:read satisfy plain read', () => {
      expect(hasGrantedScope(['admin:read'], 'read')).toBe(false)
    })

    it('does not let admin:read satisfy admin:write', () => {
      expect(hasGrantedScope(['admin:read'], 'admin:write')).toBe(false)
    })
  })

  it('returns false when nothing is granted', () => {
    expect(hasGrantedScope([], 'read')).toBe(false)
    expect(hasGrantedScope(['push'], 'read')).toBe(false)
  })
})
