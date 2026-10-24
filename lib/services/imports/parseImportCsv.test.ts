import { describe, expect, it } from 'vitest'

import { parseImportCsv } from './parseImportCsv'
import { BULK_IMPORT_ROWS_LIMIT } from './types'

describe('parseImportCsv', () => {
  describe('Mastodon export format per type', () => {
    it('parses following_accounts.csv with full headers', () => {
      const csv = [
        'Account address,Show boosts,Notify on new posts,Languages',
        'alice@example.com,true,false,"en, fr"'
      ].join('\n')

      const result = parseImportCsv({ type: 'following', text: csv })
      expect(result).toEqual({
        ok: true,
        rows: [
          {
            acct: 'alice@example.com',
            show_reblogs: true,
            notify: false,
            languages: ['en', 'fr']
          }
        ]
      })
    })

    it('parses muted_accounts.csv with Hide notifications header', () => {
      const csv = [
        'Account address,Hide notifications',
        'bob@example.com,true'
      ].join('\n')

      const result = parseImportCsv({ type: 'muting', text: csv })
      expect(result).toEqual({
        ok: true,
        rows: [
          {
            acct: 'bob@example.com',
            hide_notifications: true
          }
        ]
      })
    })

    it('parses headerless blocked_accounts.csv', () => {
      const csv = 'carol@example.com\n'

      const result = parseImportCsv({ type: 'blocking', text: csv })
      expect(result).toEqual({
        ok: true,
        rows: [
          {
            acct: 'carol@example.com'
          }
        ]
      })
    })

    it('parses blocked_domains.csv and lowercases domain', () => {
      const csv = ['#domain', 'Example.COM'].join('\n')

      const result = parseImportCsv({ type: 'domain_blocking', text: csv })
      expect(result).toEqual({
        ok: true,
        rows: [
          {
            domain: 'example.com'
          }
        ]
      })
    })

    it('parses bookmarks.csv with #uri header', () => {
      const csv = ['#uri', 'https://example.com/notes/123'].join('\n')

      const result = parseImportCsv({ type: 'bookmarks', text: csv })
      expect(result).toEqual({
        ok: true,
        rows: [
          {
            uri: 'https://example.com/notes/123'
          }
        ]
      })
    })

    it('parses lists.csv with quoted name containing comma', () => {
      const csv = [
        'List name,Account address',
        '"Friends, Family",alice@example.com'
      ].join('\n')

      const result = parseImportCsv({ type: 'lists', text: csv })
      expect(result).toEqual({
        ok: true,
        rows: [
          {
            list_name: 'Friends, Family',
            acct: 'alice@example.com'
          }
        ]
      })
    })
  })

  describe('leading @ stripping', () => {
    it('strips a single leading @ from account address', () => {
      const csv = [
        'Account address',
        '@alice@example.com',
        'bob@example.com'
      ].join('\n')

      const result = parseImportCsv({ type: 'following', text: csv })
      expect(result).toEqual({
        ok: true,
        rows: [{ acct: 'alice@example.com' }, { acct: 'bob@example.com' }]
      })
    })
  })

  describe('header filtering and missing columns', () => {
    it('omits optional attributes when their headers are not present', () => {
      const csv = ['Account address', 'alice@example.com'].join('\n')

      const result = parseImportCsv({ type: 'following', text: csv })
      expect(result.ok).toBe(true)
      if (!result.ok) return

      expect(result.rows).toHaveLength(1)
      const row = result.rows[0]
      expect(row.acct).toBe('alice@example.com')
      expect('show_reblogs' in row).toBe(false)
      expect('notify' in row).toBe(false)
      expect('languages' in row).toBe(false)
      expect(row.show_reblogs).toBeUndefined()
      expect(row.notify).toBeUndefined()
      expect(row.languages).toBeUndefined()
    })

    it('sets null for present headers whose row cells are empty or missing', () => {
      const csv = [
        'Account address,Show boosts,Notify on new posts,Languages',
        'alice@example.com,,,'
      ].join('\n')

      const result = parseImportCsv({ type: 'following', text: csv })
      expect(result).toEqual({
        ok: true,
        rows: [
          {
            acct: 'alice@example.com',
            show_reblogs: null,
            notify: null,
            languages: null
          }
        ]
      })
    })

    it('handles boolean values according to ActiveModel rules', () => {
      const csv = [
        'Account address,Show boosts,Notify on new posts,Hide notifications',
        'a@example.com,false,0,off',
        'b@example.com,f,true,1',
        'c@example.com,on,yes,t'
      ].join('\n')

      const result = parseImportCsv({ type: 'following', text: csv })
      expect(result).toEqual({
        ok: true,
        rows: [
          {
            acct: 'a@example.com',
            show_reblogs: false,
            notify: false
          },
          {
            acct: 'b@example.com',
            show_reblogs: false,
            notify: true
          },
          {
            acct: 'c@example.com',
            show_reblogs: true,
            notify: true
          }
        ]
      })
    })
  })

  describe('UTF-8 BOM and whitespace handling', () => {
    it('strips UTF-8 BOM at the beginning of the file', () => {
      const csv = '\uFEFFAccount address\nalice@example.com'

      const result = parseImportCsv({ type: 'following', text: csv })
      expect(result).toEqual({
        ok: true,
        rows: [{ acct: 'alice@example.com' }]
      })
    })

    it('handles blank lines, CRLF line endings, and whitespace rows', () => {
      const csv =
        '\r\nAccount address\r\n\r\nalice@example.com\r\n   \r\nbob@example.com\r\n\r\n'

      const result = parseImportCsv({ type: 'following', text: csv })
      expect(result).toEqual({
        ok: true,
        rows: [{ acct: 'alice@example.com' }, { acct: 'bob@example.com' }]
      })
    })

    it('returns error when file is empty or only whitespace', () => {
      expect(parseImportCsv({ type: 'following', text: '' })).toEqual({
        ok: false,
        error: 'This file is empty'
      })

      expect(
        parseImportCsv({ type: 'following', text: '   \n  \r\n\t ' })
      ).toEqual({
        ok: false,
        error: 'This file is empty'
      })

      expect(parseImportCsv({ type: 'following', text: '\uFEFF' })).toEqual({
        ok: false,
        error: 'This file is empty'
      })
    })
  })

  describe('type compatibility validation', () => {
    it('rejects muted accounts CSV uploaded as domain_blocking', () => {
      const csv = [
        'Account address,Hide notifications',
        'bob@example.com,true'
      ].join('\n')

      const result = parseImportCsv({ type: 'domain_blocking', text: csv })
      expect(result).toEqual({
        ok: false,
        error: 'This file does not match the selected import type'
      })
    })

    it('rejects domain blocking CSV uploaded as following', () => {
      const csv = ['#domain', 'example.com'].join('\n')

      const result = parseImportCsv({ type: 'following', text: csv })
      expect(result).toEqual({
        ok: false,
        error: 'This file does not match the selected import type'
      })
    })

    it('rejects lists CSV missing the Account address column', () => {
      const csv = ['List name', 'My List'].join('\n')

      const result = parseImportCsv({ type: 'lists', text: csv })
      expect(result).toEqual({
        ok: false,
        error: 'This file does not match the selected import type'
      })
    })
  })

  describe('row count limit', () => {
    it('accepts exactly 20,000 rows', () => {
      const header = 'Account address\n'
      const rows = Array.from(
        { length: BULK_IMPORT_ROWS_LIMIT },
        (_, i) => `user${i}@example.com`
      ).join('\n')
      const csv = header + rows

      const result = parseImportCsv({ type: 'following', text: csv })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.rows).toHaveLength(BULK_IMPORT_ROWS_LIMIT)
      }
    })

    it('rejects more than 20,000 rows (20,001 rows)', () => {
      const header = 'Account address\n'
      const rows = Array.from(
        { length: BULK_IMPORT_ROWS_LIMIT + 1 },
        (_, i) => `user${i}@example.com`
      ).join('\n')
      const csv = header + rows

      const result = parseImportCsv({ type: 'following', text: csv })
      expect(result).toEqual({
        ok: false,
        error: 'You can import up to 20000 rows at a time'
      })
    })
  })

  describe('malformed CSV syntax', () => {
    it('returns error when CSV has unclosed quote', () => {
      const csv = 'Account address\n"unclosed quote,alice@example.com'

      const result = parseImportCsv({ type: 'following', text: csv })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('Invalid CSV file:')
      }
    })
  })
})
