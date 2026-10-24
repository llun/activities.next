import { describe, expect, it } from 'vitest'

import { escapeCsvField, formatLanguages, toCsvRow } from './csv'

describe('csv export utilities', () => {
  describe('escapeCsvField', () => {
    it('formats null and undefined as empty string without quotes', () => {
      expect(escapeCsvField(null)).toBe('')
      expect(escapeCsvField(undefined)).toBe('')
    })

    it('formats booleans true and false as unquoted strings', () => {
      expect(escapeCsvField(true)).toBe('true')
      expect(escapeCsvField(false)).toBe('false')
    })

    it('formats empty string as two double quotes', () => {
      expect(escapeCsvField('')).toBe('""')
    })

    it('quotes strings containing a comma', () => {
      expect(escapeCsvField('hello, world')).toBe('"hello, world"')
    })

    it('quotes strings containing double quotes and doubles the inner quotes', () => {
      expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""')
      expect(escapeCsvField('foo"bar')).toBe('"foo""bar"')
    })

    it('quotes strings containing newlines or carriage returns', () => {
      expect(escapeCsvField('a\nb')).toBe('"a\nb"')
      expect(escapeCsvField('a\rb')).toBe('"a\rb"')
      expect(escapeCsvField('a\r\nb')).toBe('"a\r\nb"')
    })

    it('does not quote regular strings with spaces', () => {
      expect(escapeCsvField('hello world')).toBe('hello world')
    })

    it('does not quote strings with leading or trailing spaces', () => {
      expect(escapeCsvField('  test  ')).toBe('  test  ')
    })

    it('handles strings combining quotes, commas, and newlines', () => {
      expect(escapeCsvField('a "b", c\nd')).toBe('"a ""b"", c\nd"')
    })
  })

  describe('toCsvRow', () => {
    it('appends a newline at the end of the row', () => {
      expect(toCsvRow(['a', 'b'])).toBe('a,b\n')
    })

    it('returns a single newline for an empty fields array', () => {
      expect(toCsvRow([])).toBe('\n')
    })

    it('formats multiple fields of mixed types correctly', () => {
      const row = toCsvRow([
        'alice@example.com',
        true,
        false,
        '',
        null,
        undefined,
        'hello, world',
        'say "hi"'
      ])
      expect(row).toBe(
        'alice@example.com,true,false,"",,,"hello, world","say ""hi"""\n'
      )
    })
  })

  describe('formatLanguages', () => {
    it('returns null for null, undefined, or empty array', () => {
      expect(formatLanguages(null)).toBeNull()
      expect(formatLanguages(undefined)).toBeNull()
      // Ruby's [].join(', ') is ""
      expect(formatLanguages([])).toBe('')
    })

    it('returns language code directly when array has one item', () => {
      expect(formatLanguages(['en'])).toBe('en')
    })

    it('joins multiple languages with comma and space', () => {
      expect(formatLanguages(['en', 'fr'])).toBe('en, fr')
      expect(formatLanguages(['en', 'fr', 'ja'])).toBe('en, fr, ja')
    })

    it('integrates seamlessly with toCsvRow', () => {
      expect(
        toCsvRow([
          'alice@example.com',
          true,
          false,
          formatLanguages(['en', 'fr'])
        ])
      ).toBe('alice@example.com,true,false,"en, fr"\n')

      expect(
        toCsvRow(['alice@example.com', true, false, formatLanguages(['en'])])
      ).toBe('alice@example.com,true,false,en\n')

      expect(
        toCsvRow(['alice@example.com', true, false, formatLanguages([])])
      ).toBe('alice@example.com,true,false,""\n')

      expect(
        toCsvRow(['alice@example.com', true, false, formatLanguages(null)])
      ).toBe('alice@example.com,true,false,\n')
    })
  })
})
