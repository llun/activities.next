import {
  carryOverFieldVerification,
  profileFieldValuesChanged
} from './profileFieldVerification'

describe('carryOverFieldVerification', () => {
  const previous = [
    { name: 'Blog', value: 'https://blog.example', verifiedAt: 1000 },
    { name: 'Pronouns', value: 'they/them' }
  ]

  it('keeps the verification of a field whose value is unchanged', () => {
    expect(
      carryOverFieldVerification(
        [{ name: 'My blog', value: 'https://blog.example' }],
        previous
      )
    ).toEqual([
      { name: 'My blog', value: 'https://blog.example', verifiedAt: 1000 }
    ])
  })

  it('starts a changed value unverified', () => {
    expect(
      carryOverFieldVerification(
        [{ name: 'Blog', value: 'https://other.example' }],
        previous
      )
    ).toEqual([{ name: 'Blog', value: 'https://other.example' }])
  })

  it('never trusts a verifiedAt on the incoming field', () => {
    expect(
      carryOverFieldVerification(
        [
          { name: 'A', value: 'a', verifiedAt: 5 },
          { name: 'B', value: 'b', verifiedAt: null },
          { name: 'Blog', value: 'https://blog.example', verifiedAt: 9 }
        ],
        previous
      )
    ).toEqual([
      { name: 'A', value: 'a' },
      { name: 'B', value: 'b' },
      { name: 'Blog', value: 'https://blog.example', verifiedAt: 1000 }
    ])
  })

  it('has nothing to carry over without stored fields', () => {
    expect(
      carryOverFieldVerification([{ name: 'A', value: 'a' }], undefined)
    ).toEqual([{ name: 'A', value: 'a' }])
  })
})

describe('profileFieldValuesChanged', () => {
  it('is false for the same values, whatever the labels', () => {
    expect(
      profileFieldValuesChanged(
        [{ value: 'a' }, { value: 'b' }],
        [{ value: 'a' }, { value: 'b' }]
      )
    ).toBe(false)
  })

  it('is true for a changed, added or removed value', () => {
    expect(profileFieldValuesChanged([{ value: 'a' }], [{ value: 'b' }])).toBe(
      true
    )
    expect(
      profileFieldValuesChanged(
        [{ value: 'a' }],
        [{ value: 'a' }, { value: 'b' }]
      )
    ).toBe(true)
    expect(profileFieldValuesChanged([{ value: 'a' }], [])).toBe(true)
  })

  it('treats no stored fields as an empty list', () => {
    expect(profileFieldValuesChanged(undefined, [])).toBe(false)
    expect(profileFieldValuesChanged(undefined, [{ value: 'a' }])).toBe(true)
  })
})
