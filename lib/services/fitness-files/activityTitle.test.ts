import {
  MAX_ACTIVITY_TITLE_LENGTH,
  getActivityTitle,
  getFirstTextLine
} from './activityTitle'

describe('getFirstTextLine', () => {
  it.each([
    ['paragraphs', '<p>Morning run</p><p>Felt strong</p>', 'Morning run'],
    ['line breaks', 'Morning run<br>Felt strong', 'Morning run'],
    ['self-closing breaks', 'Morning run<br />Felt strong', 'Morning run'],
    ['raw newlines', 'Morning run\nFelt strong', 'Morning run'],
    ['CRLF newlines', 'Morning run\r\nFelt strong', 'Morning run'],
    ['an empty first paragraph', '<p></p><p>Second</p>', 'Second'],
    ['inline markup', '<p><a href="/x">Hill</a> repeats</p>', 'Hill repeats'],
    ['entities', '<p>Tom &amp; Jerry</p>', 'Tom & Jerry'],
    ['a leading emoji', '🏃 Morning run', 'Morning run'],
    ['a ZWJ emoji with skin tone', '🏃🏽‍♀️ Tempo', 'Tempo'],
    ['several leading emoji', '🚴‍♂️🔥 Ride', 'Ride'],
    ['an emoji-only first line', '<p>🏃</p><p>Easy jog</p>', 'Easy jog'],
    ['an emoji later in the line', 'Run 🏃 home', 'Run 🏃 home'],
    ['script content', '<p><script>alert(1)</script>Run</p>', 'Run']
  ])('reads %s', (_label, text, expected) => {
    expect(getFirstTextLine(text)).toBe(expected)
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['an empty string', ''],
    ['whitespace and empty blocks', ' <p> </p><br>\n']
  ])('returns null for %s', (_label, text) => {
    expect(getFirstTextLine(text)).toBeNull()
  })

  it('truncates a long line with an ellipsis at the limit', () => {
    const title = getFirstTextLine('a'.repeat(250))
    expect(title).toBe(`${'a'.repeat(MAX_ACTIVITY_TITLE_LENGTH - 1)}…`)
    expect(Array.from(title ?? '')).toHaveLength(MAX_ACTIVITY_TITLE_LENGTH)
  })

  it('never cuts an astral character in half when truncating', () => {
    const title = getFirstTextLine(`x${'😀'.repeat(200)}`) ?? ''
    expect(title.endsWith('…')).toBe(true)
    expect(title).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/)
  })
})

describe('getActivityTitle', () => {
  const fileName = 'Morning_Run.fit'

  it('prefers the post text', () => {
    expect(
      getActivityTitle({
        postText: '<p>Long run</p>',
        description: 'From the watch',
        fileName
      })
    ).toBe('Long run')
  })

  it('shows the content warning instead of the hidden body', () => {
    expect(
      getActivityTitle({
        postSummary: 'Injury update',
        postText: '<p>Knee details</p>',
        fileName
      })
    ).toBe('Injury update')
  })

  it('falls back to the description when the post has no text', () => {
    expect(
      getActivityTitle({
        postText: '',
        description: 'Lunch ride\nwith the club',
        fileName
      })
    ).toBe('Lunch ride')
  })

  it('falls back to the file name last', () => {
    expect(
      getActivityTitle({ postText: '', description: null, fileName })
    ).toBe(fileName)
  })
})
