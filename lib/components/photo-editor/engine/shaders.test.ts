import * as colour from './colour'
import {
  BLUR_FRAGMENT_SHADER,
  MAIN_FRAGMENT_SHADER,
  MASK_BLUR_FRAGMENT_SHADER,
  MASK_UNIFORM_VEC4S_PER_MASK,
  SHADER_MASK_COUNT,
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
      'WHITES_SHOULDER_START',
      'BLACKS_TOE_END',
      'TONE_EDGE_SENSITIVITY',
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
      MASK_BLUR_FRAGMENT_SHADER,
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

  describe('masks', () => {
    it('sizes the mask uniforms for four masks of three vec4', () => {
      expect(SHADER_MASK_COUNT).toBe(4)
      expect(MASK_UNIFORM_VEC4S_PER_MASK).toBe(3)
      expect(MAIN_FRAGMENT_SHADER).toContain(
        `uniform vec4 uMaskAdj[${SHADER_MASK_COUNT * MASK_UNIFORM_VEC4S_PER_MASK}];`
      )
      expect(MAIN_FRAGMENT_SHADER).toContain(
        `const int MASK_COUNT = ${SHADER_MASK_COUNT};`
      )
    })

    it('mixes each mask in recipe order, as out = mix(out, adjust(out), m)', () => {
      expect(MAIN_FRAGMENT_SHADER).toContain(
        'for (int i = 0; i < MASK_COUNT; i++)'
      )
      expect(MAIN_FRAGMENT_SHADER).toContain(
        'result = mix(result, q, masks[i]);'
      )
    })

    it('runs the mask through the same steps 2-7 and 9 as the global pass', () => {
      expect(MAIN_FRAGMENT_SHADER).toContain('vec3 q = toStep7(result, T, a);')
      expect(MAIN_FRAGMENT_SHADER).toContain(
        'q = clamp(saturate(q, a), 0.0, 1.0);'
      )
      expect(MAIN_FRAGMENT_SHADER).toContain(
        'vec3 toStep7(vec3 rgb, float T, Adj a)'
      )
      expect(MAIN_FRAGMENT_SHADER).toContain('vec3 p = toStep7(rgb, T, g);')
    })

    it('reuses the global tone value and detail terms for the mask', () => {
      expect(MAIN_FRAGMENT_SHADER).toContain(
        'detailTerm(Yq, detailFine, detailMid, a)'
      )
      // The blurs are sampled once, for the global pass.
      expect(MAIN_FRAGMENT_SHADER.match(/texture\(uBlur,/g)).toHaveLength(1)
    })

    it('has no vignette on the mask: it is applied before the masks only', () => {
      const vignette = MAIN_FRAGMENT_SHADER.indexOf(
        'VIGNETTE_STRENGTH * uVignette'
      )
      const masks = MAIN_FRAGMENT_SHADER.indexOf('MASK_COUNT; i++')
      expect(vignette).toBeGreaterThan(0)
      expect(vignette).toBeLessThan(masks)
      expect(MAIN_FRAGMENT_SHADER.match(/uVignette/g)).toHaveLength(2)
    })

    it('blurs a sigma per channel, cut at ceil(3 sigma) per channel', () => {
      expect(MASK_BLUR_FRAGMENT_SHADER).toContain('uniform vec4 uSigma;')
      expect(MASK_BLUR_FRAGMENT_SHADER).toContain(
        'vec4 reach = ceil(3.0 * uSigma);'
      )
      expect(MASK_BLUR_FRAGMENT_SHADER).toContain('step(vec4(abs(fi)), reach)')
    })
  })

  describe('perceptual tone and detail', () => {
    it('uses applyLevels with smooth toe and shoulder curve', () => {
      expect(MAIN_FRAGMENT_SHADER).toContain(
        'float applyLevels(float x, float whites, float blacks)'
      )
      expect(MAIN_FRAGMENT_SHADER).toContain(
        'applyLevels(p, a.whites, a.blacks)'
      )
      expect(MAIN_FRAGMENT_SHADER).toContain(
        'applyLevels(p.r, a.whites, a.blacks)'
      )
    })

    it('uses edge-aware effective tone to avoid halos', () => {
      expect(MAIN_FRAGMENT_SHADER).toContain(
        'float edgeWeight = clamp(abs(Y - T) * TONE_EDGE_SENSITIVITY, 0.0, 1.0);'
      )
      expect(MAIN_FRAGMENT_SHADER).toContain(
        'float effectiveT = mix(T, Y, edgeWeight);'
      )
    })

    it('evaluates mid7 with neutral white balance to preserve luma invariance', () => {
      expect(MAIN_FRAGMENT_SHADER).toContain('Adj gMid = g;')
      expect(MAIN_FRAGMENT_SHADER).toContain('gMid.temperature = 0.0;')
      expect(MAIN_FRAGMENT_SHADER).toContain('gMid.tint = 0.0;')
      expect(MAIN_FRAGMENT_SHADER).toContain(
        'vec3 mid7 = toStep7(vec3(blur.r), T, gMid);'
      )
    })
  })
})
