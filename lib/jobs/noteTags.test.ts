import { BaseNote } from '@/lib/activities/note'

import {
  isValidHashtagName,
  matchesHashtagName,
  normalizeHashtagName,
  planNoteTags
} from './noteTags'

describe('normalizeHashtagName', () => {
  it('accepts names Mastodon accepts', () => {
    expect(normalizeHashtagName('می‌خواهم')).toEqual('#می‌خواهم')
    expect(normalizeHashtagName('#می‌خواهم')).toEqual('#می‌خواهم')
    expect(normalizeHashtagName('_foo')).toEqual('#_foo')
    expect(normalizeHashtagName('foo_bar')).toEqual('#foo_bar')
    expect(normalizeHashtagName('コード・ラボ')).toEqual('#コード・ラボ')
    expect(normalizeHashtagName('a1')).toEqual('#a1')
    expect(normalizeHashtagName('1a')).toEqual('#1a')
  })

  it('rejects names that end in a separator or have no letter', () => {
    expect(normalizeHashtagName('foo·')).toEqual('')
    expect(normalizeHashtagName('foo・')).toEqual('')
    expect(normalizeHashtagName('foo‌')).toEqual('')
    expect(normalizeHashtagName('12_')).toEqual('')
    expect(normalizeHashtagName('12345')).toEqual('')
    expect(normalizeHashtagName('')).toEqual('')
    expect(normalizeHashtagName('#')).toEqual('')
  })

  it('strips characters outside the allowed set like Mastodon', () => {
    expect(normalizeHashtagName('foo-bar')).toEqual('#foobar')
    expect(normalizeHashtagName('##foo')).toEqual('#foo')
    expect(normalizeHashtagName('#foo#bar')).toEqual('#foobar')
    // "²" is not a decimal digit, so it is removed rather than kept.
    expect(normalizeHashtagName('x²')).toEqual('#x')
    expect(normalizeHashtagName('²')).toEqual('')
  })

  it('uses the same character classes as Mastodon', () => {
    // [[:alpha:]] is \p{Alphabetic}: Roman numerals and circled letters count.
    expect(normalizeHashtagName('Ⅻ')).toEqual('#Ⅻ')
    expect(normalizeHashtagName('ⅰⅱ')).toEqual('#ⅰⅱ')
    expect(normalizeHashtagName('Ⓐbc')).toEqual('#Ⓐbc')
    // Marks other than the Thai ones are stripped (virama, combining acute and
    // enclosing circle), and so is connector punctuation that is not `_`.
    expect(normalizeHashtagName('हिन्दी')).toEqual('#हिनदी')
    expect(normalizeHashtagName('cafe\u0301')).toEqual('#cafe')
    expect(normalizeHashtagName('a‿b')).toEqual('#ab')
    expect(normalizeHashtagName('x\u20DD')).toEqual('#x')
    // Only the separators `·`, `・` and ZWNJ cannot end a name.
    expect(normalizeHashtagName('1_1')).toEqual('#1_1')
    expect(normalizeHashtagName('foo_')).toEqual('#foo_')
    expect(normalizeHashtagName('foo·')).toEqual('')
  })

  it("agrees with Mastodon's regex on worst-case shaped names", () => {
    // The reference is the regex the scan replaces, which is only affordable on
    // names this short.
    const W = '\\p{Alphabetic}\\p{M}\\p{Nd}\\p{Pc}'
    const S = '_\\u00B7\\u30FB\\u200C'
    const reference = new RegExp(
      `^(?:[${W}][${W}${S}]*[\\p{Alphabetic}${S}][${W}${S}]*[${W}]|[${W}]*[\\p{Alphabetic}][${W}]*)$`,
      'u'
    )
    const names: string[] = []
    const patterns = ['1·_··_··_', '1_', '_·', '1·', 'a_', '_1·_']
    for (const pattern of patterns) {
      for (let offset = 0; offset < 9; offset++) {
        const body = pattern.repeat(Math.ceil(60 / pattern.length) + 1)
        for (const tail of ['', '·', '\u200C', '_·\u200C', 'a']) {
          names.push(body.slice(offset, offset + 60 - tail.length) + tail)
        }
      }
    }
    for (let n = 1; n <= 30; n++) names.push('1_'.repeat(n) + '\u200C')
    expect(names.length).toBeGreaterThan(100)
    for (const name of names) {
      expect(matchesHashtagName(name)).toBe(reference.test(name))
    }
  })

  it('scans worst-case names of 100k+ characters in linear time', () => {
    // Digits and separators only, so no character has a letter to stop a
    // backtracking regex early. The quadratic regex needs about 8 seconds at
    // 100k characters; the scan needs a few milliseconds. The budget is far
    // above that so a slow or busy machine does not fail the test.
    const size = 100_000
    const half = size / 2
    const names = [
      `1${'_·'.repeat(half)}·`,
      `${'1_'.repeat(half)}·`,
      `1${'_'.repeat(size)}·`,
      // Valid: starts and ends with a digit, with separators inside.
      `1${'_·'.repeat(half)}1`
    ]
    const expected = names.map((_, index) => index === names.length - 1)
    const started = performance.now()
    const results = names.map((name) => matchesHashtagName(name))
    expect(performance.now() - started).toBeLessThan(2000)
    expect(results).toEqual(expected)
  })

  it('stays fast on very long and adversarial names', () => {
    const started = performance.now()
    expect(normalizeHashtagName('a'.repeat(1_000_000))).toEqual('')
    expect(normalizeHashtagName('1'.repeat(1_000_000))).toEqual('')
    expect(normalizeHashtagName('-'.repeat(1_000_000))).toEqual('')
    expect(normalizeHashtagName(`${'_'.repeat(250)}·`)).toEqual('')
    expect(isValidHashtagName(`1${'_·'.repeat(120)}·`)).toBe(false)
    expect(performance.now() - started).toBeLessThan(5000)
  })

  it('also validates the folded name, as Mastodon does', () => {
    // "ŀ" (U+0140) is alphabetic, but folds to "l·", which ends in a separator.
    expect(isValidHashtagName('abcŀ')).toBe(true)
    expect(normalizeHashtagName('abcŀ')).toEqual('')
    expect(normalizeHashtagName('#fooŀ')).toEqual('')
    expect(normalizeHashtagName('ŀabc')).toEqual('#ŀabc')
    // The fold runs on the raw name before invalid characters are stripped.
    expect(normalizeHashtagName('محمدﷺ')).toEqual('#محمدﷺ')
    // Greek ano teleia (U+0387) folds to a middle dot, which cannot end a name.
    expect(normalizeHashtagName('abc·')).toEqual('')
    expect(normalizeHashtagName('aͺ')).not.toEqual('')
  })
})

describe('planNoteTags', () => {
  const note = (tag: unknown[]) => ({ tag }) as unknown as BaseNote

  it('keeps an http(s) hashtag href and drops any other', () => {
    const planned = planNoteTags(
      note([
        { type: 'Hashtag', name: '#one', href: 'https://x.test/tags/one' },
        { type: 'Hashtag', name: '#two', href: 'javascript:alert(1)' },
        { type: 'Hashtag', name: '#three', href: 'not a url' },
        { type: 'Hashtag', name: '#four' }
      ])
    )
    expect(planned.map((tag) => [tag.name, tag.value])).toEqual([
      ['#one', 'https://x.test/tags/one'],
      ['#two', ''],
      ['#three', ''],
      ['#four', '']
    ])
  })
})
