import { extractReplyText } from './extractReplyText'
import { REPLY_SENTINEL } from './replyMarker'

describe('extractReplyText', () => {
  it('keeps only what sits above the quoted sentinel', () => {
    const text = [
      'Sounds good, shipping it today.',
      '',
      'On Sat, Jul 25, 2026 at 9:00 PM Someone <someone@example.tld> wrote:',
      `> ${REPLY_SENTINEL}`,
      '>',
      '> @someone@example.tld mentioned you in a post.',
      '>',
      '> Message: are we shipping today?'
    ].join('\n')

    expect(extractReplyText({ text })).toBe('Sounds good, shipping it today.')
  })

  it('keeps a multi-line reply intact', () => {
    const text = [
      'Two things:',
      '',
      '1. yes',
      '2. tomorrow',
      '',
      'On Sat, Jul 25, 2026 at 9:00 PM Someone <someone@example.tld> wrote:',
      `> ${REPLY_SENTINEL}`
    ].join('\n')

    expect(extractReplyText({ text })).toBe(
      'Two things:\n\n1. yes\n2. tomorrow'
    )
  })

  it('removes an attribution wrapped across lines', () => {
    const text = [
      'Ack.',
      '',
      'On Sat, Jul 25, 2026 at 9:00 PM Someone Very Long Name',
      '<someone@example.tld> wrote:',
      `> ${REPLY_SENTINEL}`
    ].join('\n')

    expect(extractReplyText({ text })).toBe('Ack.')
  })

  it('cuts at a quoted block when the sentinel is missing', () => {
    const text = [
      'Forwarding my answer.',
      '',
      'On Sat, Jul 25, 2026 at 9:00 PM Someone <someone@example.tld> wrote:',
      '> the original message',
      '> spanning two lines'
    ].join('\n')

    expect(extractReplyText({ text })).toBe('Forwarding my answer.')
  })

  it.each([
    {
      description: 'an Outlook original-message divider',
      tail: ['-----Original Message-----', 'From: someone@example.tld']
    },
    {
      description: 'a forwarded-message divider',
      tail: ['---------- Forwarded message ----------', 'From: a@b.tld']
    },
    {
      description: 'an Outlook underscore rule',
      tail: ['________________________________', 'From: a@b.tld']
    }
  ])('cuts at $description', ({ tail }) => {
    const text = ['My answer.', '', ...tail].join('\n')
    expect(extractReplyText({ text })).toBe('My answer.')
  })

  it('strips a trailing signature block', () => {
    const text = [
      'Done.',
      '',
      '-- ',
      'Alice',
      'Sent from a phone',
      '',
      'On Sat, Jul 25, 2026 at 9:00 PM Someone <someone@example.tld> wrote:',
      `> ${REPLY_SENTINEL}`
    ].join('\n')

    expect(extractReplyText({ text })).toBe('Done.')
  })

  it('leaves a quoted signature delimiter alone', () => {
    const text = ['Reply body.', '', '> -- ', '> Their signature'].join('\n')
    expect(extractReplyText({ text })).toBe('Reply body.')
  })

  it('falls back to the HTML part when there is no text part', () => {
    const html = `<p>Just this bit.</p><p>${REPLY_SENTINEL}</p><h3>@someone mentioned you</h3>`
    expect(extractReplyText({ html })).toBe('Just this bit.')
  })

  it('falls back to the HTML part when the text part is only whitespace', () => {
    const html = `<div>From the HTML part.</div><div>${REPLY_SENTINEL}</div>`
    expect(extractReplyText({ text: '   \n  ', html })).toBe(
      'From the HTML part.'
    )
  })

  it('normalizes CRLF line endings', () => {
    const text = `Windows reply.\r\n\r\n> ${REPLY_SENTINEL}\r\n> body`
    expect(extractReplyText({ text })).toBe('Windows reply.')
  })

  it.each([
    { description: 'both parts missing', input: {} },
    { description: 'an empty text part', input: { text: '' } },
    { description: 'a whitespace-only text part', input: { text: '  \n\n ' } },
    {
      description: 'nothing above the sentinel',
      input: { text: `${REPLY_SENTINEL}\n\n> quoted body` }
    },
    {
      description: 'only a quoted block',
      input: { text: '> quoted body\n> more quoted body' }
    },
    {
      description: 'only a signature above the quote',
      input: { text: `-- \nAlice\n\n> ${REPLY_SENTINEL}` }
    }
  ])('returns an empty string for $description', ({ input }) => {
    expect(extractReplyText(input)).toBe('')
  })

  it('does not cut a reply that merely contains the word wrote', () => {
    const text = [
      'I wrote: this is fine, keep it.',
      '',
      `> ${REPLY_SENTINEL}`
    ].join('\n')

    expect(extractReplyText({ text })).toBe('I wrote: this is fine, keep it.')
  })

  it('keeps the whole body when there is nothing to cut', () => {
    expect(extractReplyText({ text: 'just a plain reply' })).toBe(
      'just a plain reply'
    )
  })
})
