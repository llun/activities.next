import { parseEmailAddress, splitEmailAddress } from './address'

describe('parseEmailAddress', () => {
  it.each([
    { description: 'a bare address', input: 'someone@example.tld' },
    { description: 'a padded address', input: '  someone@example.tld  ' },
    {
      description: 'a display name with an angle-addr',
      input: '"Some One" <someone@example.tld>'
    },
    {
      description: 'an unquoted display name',
      input: 'Some One <someone@example.tld>'
    },
    {
      description: 'a plus-addressed recipient',
      input: '<reply+abc_123@example.tld>'
    }
  ])('extracts the addr-spec from $description', ({ input }) => {
    expect(parseEmailAddress(input)).toMatch(/@example\.tld$/)
  })

  it.each([
    { description: 'null', input: null },
    { description: 'undefined', input: undefined },
    { description: 'an empty string', input: '' },
    { description: 'a value with no @', input: 'not-an-address' },
    { description: 'a value with two @', input: 'a@b@example.tld' },
    { description: 'a value with no local part', input: '@example.tld' },
    { description: 'a value with no domain', input: 'someone@' },
    {
      description: 'a value with embedded whitespace',
      input: 'some one@example.tld'
    }
  ])('returns null for $description', ({ input }) => {
    expect(parseEmailAddress(input)).toBeNull()
  })
})

describe('splitEmailAddress', () => {
  it('lowercases the domain but leaves the local part untouched', () => {
    expect(splitEmailAddress('Reply+AbC@Example.TLD')).toEqual({
      localPart: 'Reply+AbC',
      domain: 'example.tld'
    })
  })

  it('returns null when there is no local part', () => {
    expect(splitEmailAddress('@example.tld')).toBeNull()
  })
})
