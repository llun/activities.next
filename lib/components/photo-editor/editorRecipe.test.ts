import { NEUTRAL_RECIPE } from '@/lib/services/medias/edit/recipe'

import { recipesEqual, recipesRenderEqual, withGeometry } from './editorRecipe'

describe('recipesRenderEqual', () => {
  const withAspect = (aspect: '1:1' | 'free', portrait?: boolean) =>
    withGeometry(NEUTRAL_RECIPE, {
      ...NEUTRAL_RECIPE.geometry,
      aspect,
      ...(portrait ? { aspectPortrait: true } : {})
    })

  it('ignores an aspect label that leaves the crop alone', () => {
    const picked = withAspect('1:1', true)
    expect(recipesEqual(picked, NEUTRAL_RECIPE)).toBe(false)
    expect(recipesRenderEqual(picked, NEUTRAL_RECIPE)).toBe(true)
  })

  it('still sees a different crop', () => {
    const cropped = withGeometry(NEUTRAL_RECIPE, {
      ...NEUTRAL_RECIPE.geometry,
      aspect: '1:1',
      crop: { x: 0.1, y: 0, width: 0.8, height: 1 }
    })
    expect(recipesRenderEqual(cropped, NEUTRAL_RECIPE)).toBe(false)
  })
})
