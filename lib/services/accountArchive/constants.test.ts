import { isArchiveStoragePath } from './constants'

describe('isArchiveStoragePath', () => {
  it.each([
    'archives/abc/token/archive-1.zip',
    'archives',
    'Archives/abc/x.zip',
    'archives\\abc\\x.zip',
    '/archives/abc/x.zip'
  ])('treats %j as an export file', (file) => {
    expect(isArchiveStoragePath(file)).toBe(true)
  })

  it.each([
    'medias/2026-01-01/a.jpg',
    'archives-old/a.jpg',
    'medias/archives/a.jpg',
    'fitness/archives/a.fit'
  ])('leaves %j to the media cleanup', (file) => {
    expect(isArchiveStoragePath(file)).toBe(false)
  })
})
