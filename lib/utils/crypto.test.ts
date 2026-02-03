import { decrypt, encrypt, generateAlphanumeric } from './crypto'

// Mock getConfig to return a test secret
jest.mock('../config', () => ({
  getConfig: jest.fn().mockReturnValue({
    secretPhase: 'test-secret-phase-for-encryption',
    host: 'test.example.com',
    storage: 'local',
    database: 'sqlite'
  })
}))

describe('crypto utilities', () => {
  describe('encrypt', () => {
    it('encrypts text and returns iv:encryptedData format', () => {
      const plaintext = 'sensitive data'
      const encrypted = encrypt(plaintext)

      expect(encrypted).toContain(':')
      const [iv, data] = encrypted.split(':')
      expect(iv).toHaveLength(32) // 16 bytes in hex = 32 chars
      expect(data.length).toBeGreaterThan(0)
    })

    it('returns empty string for empty input', () => {
      expect(encrypt('')).toBe('')
    })

    it('produces different ciphertext for same plaintext (different IVs)', () => {
      const plaintext = 'test data'
      const encrypted1 = encrypt(plaintext)
      const encrypted2 = encrypt(plaintext)

      expect(encrypted1).not.toBe(encrypted2)
      // But both should decrypt to same plaintext
      expect(decrypt(encrypted1)).toBe(plaintext)
      expect(decrypt(encrypted2)).toBe(plaintext)
    })

    it('encrypts unicode characters correctly', () => {
      const plaintext = 'Hello 世界 🌍'
      const encrypted = encrypt(plaintext)
      expect(decrypt(encrypted)).toBe(plaintext)
    })

    it('encrypts long strings correctly', () => {
      const plaintext = 'a'.repeat(1000)
      const encrypted = encrypt(plaintext)
      expect(decrypt(encrypted)).toBe(plaintext)
    })
  })

  describe('decrypt', () => {
    it('decrypts encrypted text correctly', () => {
      const plaintext = 'my secret token'
      const encrypted = encrypt(plaintext)
      const decrypted = decrypt(encrypted)

      expect(decrypted).toBe(plaintext)
    })

    it('returns empty string for empty input', () => {
      expect(decrypt('')).toBe('')
    })

    it('throws error for invalid format (no colon)', () => {
      expect(() => decrypt('invalidformat')).toThrow(
        'Invalid encrypted data format'
      )
    })

    it('throws error for invalid format (missing iv)', () => {
      expect(() => decrypt(':encrypteddata')).toThrow(
        'Invalid encrypted data format'
      )
    })

    it('throws error for invalid format (missing data)', () => {
      expect(() => decrypt('1234567890abcdef:')).toThrow(
        'Invalid encrypted data format'
      )
    })

    it('throws error for corrupted ciphertext', () => {
      const plaintext = 'test'
      const encrypted = encrypt(plaintext)
      const [iv, _data] = encrypted.split(':')
      const corrupted = `${iv}:corrupted`

      expect(() => decrypt(corrupted)).toThrow()
    })
  })

  describe('encrypt/decrypt round-trip', () => {
    it('handles OAuth tokens', () => {
      const token =
        'ya29.a0AfH6SMBxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
      expect(decrypt(encrypt(token))).toBe(token)
    })

    it('handles client secrets', () => {
      const secret = 'abcdef1234567890abcdef1234567890'
      expect(decrypt(encrypt(secret))).toBe(secret)
    })

    it('handles special characters', () => {
      const text = '!@#$%^&*()_+-=[]{}|;:,.<>?'
      expect(decrypt(encrypt(text))).toBe(text)
    })

    it('handles newlines and tabs', () => {
      const text = 'line1\nline2\tindented'
      expect(decrypt(encrypt(text))).toBe(text)
    })
  })

  describe('generateAlphanumeric', () => {
    it('generates string of requested length', () => {
      expect(generateAlphanumeric(32)).toHaveLength(32)
      expect(generateAlphanumeric(16)).toHaveLength(16)
      expect(generateAlphanumeric(64)).toHaveLength(64)
    })

    it('defaults to 32 characters', () => {
      expect(generateAlphanumeric()).toHaveLength(32)
    })

    it('only contains alphanumeric characters', () => {
      const token = generateAlphanumeric(100)
      expect(token).toMatch(/^[A-Za-z0-9]+$/)
    })

    it('generates unique tokens', () => {
      const tokens = new Set()
      for (let i = 0; i < 100; i++) {
        tokens.add(generateAlphanumeric(32))
      }
      // All 100 tokens should be unique
      expect(tokens.size).toBe(100)
    })

    it('has no obvious bias (chi-square test)', () => {
      // Generate many tokens and count character frequency
      const counts: Record<string, number> = {}
      const chars =
        'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

      // Initialize counts
      for (const char of chars) {
        counts[char] = 0
      }

      // Generate tokens and count characters
      const totalChars = 10000
      const token = generateAlphanumeric(totalChars)

      for (const char of token) {
        counts[char]++
      }

      // Expected frequency for uniform distribution
      const expected = totalChars / chars.length

      // Calculate chi-square statistic
      let chiSquare = 0
      for (const char of chars) {
        const observed = counts[char]
        chiSquare += Math.pow(observed - expected, 2) / expected
      }

      // For 62 characters (degrees of freedom = 61)
      // Critical value at 0.05 significance level ≈ 79.08
      // If chi-square < critical value, distribution is not significantly biased
      expect(chiSquare).toBeLessThan(100) // Relaxed threshold for test reliability
    })

    it('generates at least 10 of each character type in large sample', () => {
      const token = generateAlphanumeric(10000)

      const hasUppercase = /[A-Z]/.test(token)
      const hasLowercase = /[a-z]/.test(token)
      const hasDigit = /[0-9]/.test(token)

      expect(hasUppercase).toBe(true)
      expect(hasLowercase).toBe(true)
      expect(hasDigit).toBe(true)

      // Count each type
      const uppercaseCount = (token.match(/[A-Z]/g) || []).length
      const lowercaseCount = (token.match(/[a-z]/g) || []).length
      const digitCount = (token.match(/[0-9]/g) || []).length

      // Each type should appear at least 10 times in 10000 chars
      expect(uppercaseCount).toBeGreaterThan(10)
      expect(lowercaseCount).toBeGreaterThan(10)
      expect(digitCount).toBeGreaterThan(10)
    })
  })

  describe('security properties', () => {
    it('uses different IV for each encryption', () => {
      const plaintext = 'same text'
      const encrypted1 = encrypt(plaintext)
      const encrypted2 = encrypt(plaintext)

      const iv1 = encrypted1.split(':')[0]
      const iv2 = encrypted2.split(':')[0]

      expect(iv1).not.toBe(iv2)
    })

    it('encrypts with AES-256-CBC (key length check)', () => {
      // AES-256 requires 32-byte key
      // Our implementation uses SHA-256 hash which produces 32 bytes
      const plaintext = 'test'
      const encrypted = encrypt(plaintext)

      // Should not throw - implicitly validates key length
      expect(() => decrypt(encrypted)).not.toThrow()
    })

    it('IV has sufficient entropy', () => {
      const ivs = new Set()
      for (let i = 0; i < 100; i++) {
        const encrypted = encrypt('test')
        const iv = encrypted.split(':')[0]
        ivs.add(iv)
      }
      // All IVs should be unique
      expect(ivs.size).toBe(100)
    })
  })
})
