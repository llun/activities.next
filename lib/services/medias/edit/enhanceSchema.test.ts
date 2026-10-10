import { describe, expect, it } from 'vitest'

import {
  AiAdjustments,
  ENHANCE_STYLES,
  parseEnhanceAnswer
} from './enhanceSchema'

const style = {
  global: { exposure: 0.4, contrast: 10, temperature: -5 },
  subject: { highlights: -20 },
  background: null
}
const answer = { natural: style, vivid: style, dramatic: style }
const json = JSON.stringify(answer)

describe('parseEnhanceAnswer', () => {
  it('reads plain JSON', () => {
    expect(parseEnhanceAnswer(json)).toEqual(answer)
  })

  it.each([
    ['a json fence', `\`\`\`json\n${json}\n\`\`\``],
    ['a bare fence', `\`\`\`\n${json}\n\`\`\``],
    ['a fence and padding', `\n  \`\`\`json\r\n${json}\r\n\`\`\`  \n`],
    ['padding', `  ${json}\n`]
  ])('accepts %s', (_, text) => {
    expect(parseEnhanceAnswer(text)).toEqual(answer)
  })

  it.each([
    ['empty text', ''],
    ['prose around the JSON', `Here you go: ${json}`],
    ['trailing prose after a fence', `\`\`\`json\n${json}\n\`\`\`\nEnjoy!`],
    ['malformed JSON', '{"natural":'],
    ['a JSON array', '[]'],
    ['a missing style', JSON.stringify({ natural: style, vivid: style })],
    ['an extra style', JSON.stringify({ ...answer, cinematic: style })],
    [
      'an extra key on a style',
      JSON.stringify({ ...answer, vivid: { ...style, notes: 'x' } })
    ],
    [
      'an unknown adjustment key',
      JSON.stringify({
        ...answer,
        vivid: { ...style, global: { sharpen: 10 } }
      })
    ],
    [
      'a vignette in subject values',
      JSON.stringify({
        ...answer,
        vivid: { ...style, subject: { vignette: 10 } }
      })
    ],
    [
      'a vignette in background values',
      JSON.stringify({
        ...answer,
        vivid: { ...style, background: { vignette: 10 } }
      })
    ],
    [
      'a missing global',
      JSON.stringify({ ...answer, vivid: { subject: null, background: null } })
    ],
    [
      'a string number',
      JSON.stringify({
        ...answer,
        vivid: { ...style, global: { contrast: '5' } }
      })
    ]
  ])('rejects %s', (_, text) => {
    expect(parseEnhanceAnswer(text)).toBeNull()
  })

  it.each([
    ['exposure above 1.5', { exposure: 1.51 }],
    ['exposure below -1.5', { exposure: -1.51 }],
    ['contrast above 60', { contrast: 61 }],
    ['clarity below -60', { clarity: -61 }],
    ['temperature above 30', { temperature: 31 }],
    ['tint below -30', { tint: -31 }],
    ['a fractional step', { saturation: 12.5 }],
    ['a null value', { shadows: null }]
  ])('rejects %s', (_, global) => {
    const text = JSON.stringify({ ...answer, dramatic: { ...style, global } })
    expect(parseEnhanceAnswer(text)).toBeNull()
  })

  it.each([
    ['exposure at 1.5', { exposure: 1.5 }],
    ['exposure at -1.5', { exposure: -1.5 }],
    ['a step at 60', { vibrance: 60 }],
    ['a step at -60', { whites: -60 }],
    ['temperature at 30', { temperature: 30 }],
    ['tint at -30', { tint: -30 }],
    ['an empty object', {}]
  ])('accepts %s', (_, global) => {
    const text = JSON.stringify({ ...answer, dramatic: { ...style, global } })
    expect(parseEnhanceAnswer(text)?.dramatic.global).toEqual(global)
  })

  it('takes null for the subject and the background', () => {
    const text = JSON.stringify({
      ...answer,
      vivid: { global: {}, subject: null, background: null }
    })
    expect(parseEnhanceAnswer(text)?.vivid).toEqual({
      global: {},
      subject: null,
      background: null
    })
  })
})

describe('the schema', () => {
  it('offers the three styles in order', () => {
    expect(ENHANCE_STYLES).toEqual(['natural', 'vivid', 'dramatic'])
  })

  it('allows a vignette in the global values only', () => {
    expect(AiAdjustments.safeParse({ vignette: 20 }).success).toBeTrue()
  })
})
