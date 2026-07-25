import { EditableStatus, StatusType } from '@/lib/types/domain/status'

import { getStatusBody } from './statusBody'

const BASE_URL = 'https://test.llun.dev'

const status = (overrides: Partial<EditableStatus> = {}): EditableStatus =>
  ({
    id: `${BASE_URL}/statuses/1`,
    url: `${BASE_URL}/@user/1`,
    actorId: `${BASE_URL}/users/user`,
    type: StatusType.enum.Note,
    text: 'hello',
    summary: '',
    to: [],
    cc: [],
    tags: [],
    attachments: [],
    replies: [],
    createdAt: 1000,
    ...overrides
  }) as EditableStatus

describe('getStatusBody', () => {
  it('absolutizes the relative hashtag link convertMarkdownText emits', () => {
    const { html } = getStatusBody(
      status({ text: 'a #tag here', isLocalActor: true })
    )
    // The whole point: `/tags/tag` has no origin to resolve against in an inbox.
    expect(html).not.toMatch(/href="\/(?!\/)/)
    expect(html).toContain(`href="${BASE_URL}/tags/tag"`)
  })

  it('absolutizes a relative href that survives sanitizeText on the remote path', () => {
    const { html } = getStatusBody(
      status({ text: '<a href="/foo">x</a>', isLocalActor: false })
    )
    expect(html).toContain(`href="${BASE_URL}/foo"`)
  })

  it('leaves a protocol-relative url alone because it points at another origin', () => {
    const { html } = getStatusBody(
      status({ text: '<a href="//evil.example/x">x</a>', isLocalActor: false })
    )
    expect(html).not.toContain(`${BASE_URL}//evil.example`)
  })

  it('leaves an already absolute url alone', () => {
    const { html } = getStatusBody(
      status({ text: '<a href="https://other.test/x">x</a>' })
    )
    expect(html).toContain('href="https://other.test/x"')
  })

  it('strips markup from the plain-text twin', () => {
    const { text } = getStatusBody(
      status({ text: '<p>Hello <b>there</b></p>', isLocalActor: false })
    )
    expect(text).not.toContain('<')
    expect(text).toContain('Hello')
    expect(text).toContain('there')
  })

  it.each([
    { description: 'a local author', isLocalActor: true },
    { description: 'a remote author', isLocalActor: false }
  ])('strips raw html from $description', ({ isLocalActor }) => {
    // The local branch runs markdown, which does NOT sanitize — marked has
    // shipped no sanitizer since v5. Without an unconditional sanitize step a
    // local user could plant a tracking pixel or a layout-breaking <style> in
    // someone else's inbox, and quote() emits this value unescaped.
    const { html } = getStatusBody(
      status({
        text: 'Hi <img src="https://tracker.evil.example/p.gif" onerror="alert(1)"><script>alert(2)</script><style>body{display:none}</style>',
        isLocalActor
      })
    )
    expect(html).not.toContain('<script')
    expect(html).not.toContain('<style')
    expect(html).not.toContain('onerror')
    expect(html).not.toContain('tracker.evil.example')
  })

  it('still renders markdown for a local author', () => {
    const { html } = getStatusBody(
      status({ text: 'a **bold** word', isLocalActor: true })
    )
    expect(html).toContain('<strong>bold</strong>')
  })
})
