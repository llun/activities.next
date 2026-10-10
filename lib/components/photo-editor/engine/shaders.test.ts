import * as colour from './colour'
import {
  BLUR_FRAGMENT_SHADER,
  MAIN_FRAGMENT_SHADER,
  VERTEX_SHADER,
  glFloat
} from './shaders'

describe('shaders', () => {
  it.each(Object.entries(colour.SHADER_CONSTANTS))(
    'declares %s from colour.ts',
    (name, value) => {
      expect(MAIN_FRAGMENT_SHADER).toContain(
        `const float ${name} = ${glFloat(value)};`
      )
      expect(BLUR_FRAGMENT_SHADER).toContain(
        `const float ${name} = ${glFloat(value)};`
      )
    }
  )

  it('lists every numeric tuning constant that colour.ts exports for the colour pass', () => {
    const tuning = [
      'WB_TEMPERATURE_GAIN',
      'WB_TINT_GAIN',
      'WHITES_RANGE',
      'BLACKS_RANGE',
      'TONE_STRENGTH',
      'TEXTURE_GAIN',
      'CLARITY_GAIN',
      'VIGNETTE_STRENGTH',
      'VIGNETTE_START'
    ]
    for (const name of tuning) {
      expect(Object.keys(colour.SHADER_CONSTANTS)).toContain(name)
    }
  })

  it('formats floats with a decimal point', () => {
    expect(glFloat(1)).toBe('1.0')
    expect(glFloat(0.2)).toBe('0.2')
    expect(glFloat(0.0001)).toBe('0.0001')
  })

  it('uses GLSL ES 3.00 throughout', () => {
    for (const source of [
      VERTEX_SHADER,
      BLUR_FRAGMENT_SHADER,
      MAIN_FRAGMENT_SHADER
    ]) {
      expect(source.startsWith('#version 300 es')).toBe(true)
    }
  })

  it('bakes the fine detail kernel into the colour pass', () => {
    const total = colour.FINE_KERNEL_1D.reduce((sum, w) => sum + w, 0)
    expect(total).toBeCloseTo(1, 6)
    expect(MAIN_FRAGMENT_SHADER).toContain(glFloat(colour.FINE_KERNEL_1D[2]))
  })
})
