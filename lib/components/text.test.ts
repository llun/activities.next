import { convertQuoteToCode } from './text'

describe('#convertQuoteToCode', () => {
  it('Keep text as it is when there is not quotes', () => {
    expect(convertQuoteToCode('Test no code block')).toEqual(
      'Test no code block'
    )
  })

  it('replace quote block to code block', () => {
    expect(convertQuoteToCode('Message with `quote` block')).toEqual(
      'Message with <code>quote</code> block'
    )
  })

  it('replace all quote blocks to code blocks', () => {
    expect(
      convertQuoteToCode(
        'Message with multiple `quote` blocks, e.g. another `quote` here'
      )
    ).toEqual(
      'Message with multiple <code>quote</code> blocks, e.g. another <code>quote</code> here'
    )
  })

  it('replace quote with space', () => {
    expect(
      convertQuoteToCode('Message with `quote that has space` in it')
    ).toEqual('Message with <code>quote that has space</code> in it')
  })
})
