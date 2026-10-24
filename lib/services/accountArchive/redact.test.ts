import { redactArchiveRoot, toArchiveLoggableError } from './redact'

const SECRET = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde'

describe('archive log redaction', () => {
  it('removes the secret segment of a path and a key', () => {
    expect(redactArchiveRoot(`/data/archives/abc-1/${SECRET}/x.partial`)).toBe(
      '/data/archives/<redacted>/x.partial'
    )
    expect(redactArchiveRoot(`archives/abc-1/${SECRET}/stage/p-0`)).toBe(
      'archives/<redacted>/stage/p-0'
    )
    expect(redactArchiveRoot('medias/2026/a.jpg')).toBe('medias/2026/a.jpg')
  })

  it('redacts the message and the stack of an fs error and keeps its code', () => {
    const error = Object.assign(
      new Error(`ENOSPC: no space, write '/data/archives/id/${SECRET}/a.zip'`),
      { code: 'ENOSPC' }
    )
    const safe = toArchiveLoggableError(error) as NodeJS.ErrnoException
    expect(safe.message).not.toContain(SECRET)
    expect(safe.stack).not.toContain(SECRET)
    expect(safe.code).toBe('ENOSPC')
  })
})
