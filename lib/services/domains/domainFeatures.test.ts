import {
  type FeatureFlags,
  applyDisabledFeatures,
  isDomainFeature,
  parseDisabledFeatures
} from './domainFeatures'

describe('parseDisabledFeatures', () => {
  it.each([
    { value: null, expected: [] },
    { value: undefined, expected: [] },
    { value: '', expected: [] },
    { value: '[]', expected: [] },
    { value: '["messages"]', expected: ['messages'] },
    // Registry order, known features only, no duplicates.
    {
      value: '["messages","nope","fitness","messages"]',
      expected: ['fitness', 'messages']
    },
    // A bad value fails open: a feature switch only hides navigation.
    { value: '{"fitness":true}', expected: [] },
    { value: 'fitness', expected: [] },
    { value: '[1,2]', expected: [] }
  ])('reads $value as $expected', ({ value, expected }) => {
    expect(parseDisabledFeatures(value)).toEqual(expected)
  })
})

describe('applyDisabledFeatures', () => {
  const allOn: FeatureFlags = { fitness: true, explore: true, messages: true }

  it('turns off what the domain lists and keeps the rest', () => {
    expect(applyDisabledFeatures(allOn, ['explore'])).toEqual({
      fitness: true,
      explore: false,
      messages: true
    })
    expect(applyDisabledFeatures(allOn, [])).toEqual(allOn)
  })

  it('never turns on what the server has off', () => {
    expect(
      applyDisabledFeatures(
        { fitness: false, explore: true, messages: false },
        ['explore']
      )
    ).toEqual({ fitness: false, explore: false, messages: false })
    expect(
      applyDisabledFeatures(
        { fitness: false, explore: false, messages: false },
        []
      )
    ).toEqual({ fitness: false, explore: false, messages: false })
  })
})

describe('isDomainFeature', () => {
  it('knows the three features', () => {
    expect(['fitness', 'explore', 'messages'].every(isDomainFeature)).toBe(true)
    expect(isDomainFeature('gallery')).toBe(false)
    expect(isDomainFeature(1)).toBe(false)
  })
})
