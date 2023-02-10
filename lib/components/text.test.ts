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

  it('does not convert quote if there is no space before and after', () => {
    expect(convertQuoteToCode('Text with`embedded quote`inside')).toEqual(
      'Text with`embedded quote`inside'
    )

    expect(convertQuoteToCode('Text end with`embedded quote`')).toEqual(
      'Text end with`embedded quote`'
    )

    expect(
      convertQuoteToCode('`Embedded quote`Text at the beginning of text')
    ).toEqual('`Embedded quote`Text at the beginning of text')
  })

  it('convert quote when it live alone', () => {
    expect(convertQuoteToCode('`Quote here`')).toEqual(
      '<code>Quote here</code>'
    )
  })

  it('convert quote when it inside the tag alone', () => {
    expect(convertQuoteToCode('<p>`Quote here`</p>')).toEqual(
      '<p><code>Quote here</code></p>'
    )
  })
})
