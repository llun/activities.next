import { isMastodonHashtagName, normalizeHashtagParam } from './mastodonHashtag'

describe('isMastodonHashtagName', () => {
  it.each([
    { description: 'an ascii word tag', name: 'running', expected: true },
    { description: 'an underscore tag', name: 'trail_running', expected: true },
    { description: 'japanese letters', name: '日本語', expected: true },
    { description: 'thai letters', name: 'ไทย', expected: true },
    { description: 'accented letters', name: 'café', expected: true },
    { description: 'digits only', name: '2024', expected: true },
    { description: 'an empty string', name: '', expected: false },
    { description: 'a space', name: 'two words', expected: false },
    { description: 'a dash', name: 'foo-bar', expected: false },
    { description: 'a leading hash', name: '#running', expected: false },
    { description: 'an emoji', name: 'fun🎉', expected: false }
  ])('returns $expected for $description', ({ name, expected }) => {
    expect(isMastodonHashtagName(name)).toBe(expected)
  })
})

describe('normalizeHashtagParam', () => {
  it.each([
    {
      description: 'a plain ascii name',
      param: 'running',
      expected: 'running'
    },
    {
      description: 'a decoded unicode name',
      param: '日本語',
      expected: '日本語'
    },
    {
      description: 'a percent-encoded unicode name',
      param: '%E6%97%A5%E6%9C%AC%E8%AA%9E',
      expected: '日本語'
    },
    {
      description: 'an encoded leading hash',
      param: '%23running',
      expected: 'running'
    },
    { description: 'invalid characters', param: 'foo-bar', expected: null },
    {
      description: 'an undecodable percent sequence',
      param: '100%zz',
      expected: null
    },
    { description: 'an empty string', param: '', expected: null }
  ])('returns $expected for $description', ({ param, expected }) => {
    expect(normalizeHashtagParam(param)).toBe(expected)
  })
})
