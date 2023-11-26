/* eslint-disable no-template-curly-in-string */
import { convertQuoteToCode } from './convertQuoteToCode'

describe('#convertQuoteToCode', () => {
  it('Keep text as it is when there is not quotes', () => {
    expect(convertQuoteToCode('Test no code block')).toEqual(
      'Test no code block'
    )
  })

  it('replace quote block to code block', () => {
    expect(convertQuoteToCode('Message with `quote` block')).toEqual(
      'Message with <code>`quote`</code> block'
    )
  })

  it('replace all quote blocks to code blocks', () => {
    expect(
      convertQuoteToCode(
        'Message with multiple `quote` blocks, e.g. another `quote` here'
      )
    ).toEqual(
      'Message with multiple <code>`quote`</code> blocks, e.g. another <code>`quote`</code> here'
    )
  })

  it('replace quote with space', () => {
    expect(
      convertQuoteToCode('Message with `quote that has space` in it')
    ).toEqual('Message with <code>`quote that has space`</code> in it')
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
      '<code>`Quote here`</code>'
    )
  })

  it('convert quote when it inside the tag alone', () => {
    expect(convertQuoteToCode('<p>`Quote here`</p>')).toEqual(
      '<p><code>`Quote here`</code></p>'
    )
  })

  it('convert quote blocks with $, {, }, ?, - to code blocks', () => {
    expect(convertQuoteToCode('`${status?.id}-${type}-${date}`')).toEqual(
      '<code>`${status?.id}-${type}-${date}`</code>'
    )
  })

  it('convert quote blocks when end with .', () => {
    expect(convertQuoteToCode('this should be `quote block`.')).toEqual(
      'this should be <code>`quote block`</code>.'
    )
  })

  it('convert quote blocks when end with ,', () => {
    expect(convertQuoteToCode('this should be `quote`, `block`.')).toEqual(
      'this should be <code>`quote`</code>, <code>`block`</code>.'
    )
  })

  it('convert quote blocks for multiple stopping correctly', () => {
    const text =
      '<p>need a regex class for ending sentence character (`.`, `,` etc)</p>'
    expect(convertQuoteToCode(text)).toEqual(
      '<p>need a regex class for ending sentence character (<code>`.`</code>, <code>`,`</code> etc)</p>'
    )
  })

  it('convert quote blocks for text ending with ?', () => {
    const text = '<p>Sample quote text with `question mark`? ending</p>'
    expect(convertQuoteToCode(text)).toEqual(
      '<p>Sample quote text with <code>`question mark`</code>? ending</p>'
    )
  })

  it('convert quote block for text ending with :', () => {
    const text = '<p>Sample quote text with `quote`: ending</p>'
    expect(convertQuoteToCode(text)).toEqual(
      '<p>Sample quote text with <code>`quote`</code>: ending</p>'
    )
  })

  it('convert quote block for other languages', () => {
    const text =
      '<p>Quote block for other languages `ภาษาไทย`, `中文`, `إسرائيل`</p>'
    expect(convertQuoteToCode(text)).toEqual(
      '<p>Quote block for other languages <code>`ภาษาไทย`</code>, <code>`中文`</code>, <code>`إسرائيل`</code></p>'
    )
  })

  it('convert to quote for link block', () => {
    const text =
      '<p>Testing quote with link inside e.g. `<a href="https://www.llun.social/" target="_blank" rel="nofollow noopener noreferrer">llun.social</a>`</p>'
    expect(convertQuoteToCode(text)).toEqual(
      '<p>Testing quote with link inside e.g. <code>`<a href="https://www.llun.social/" target="_blank" rel="nofollow noopener noreferrer">llun.social</a>`</code></p>'
    )
  })
})
