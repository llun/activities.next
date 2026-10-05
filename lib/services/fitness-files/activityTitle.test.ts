import {
  CONTENT_WARNING_TITLE,
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
    ['script content', '<p><script>alert(1)</script>Run</p>', 'Run'],
    ['an invisible-only first line', '<p>\u200b</p><p>Second</p>', 'Second'],
    ['a Thai line with combining vowels', 'วิ่งเช้า', 'วิ่งเช้า'],
    [
      'a line after a long invisible run',
      `${'\u200b'.repeat(MAX_ACTIVITY_TITLE_LENGTH + 80)}X`,
      'X'
    ]
  ])('reads %s', (_label, text, expected) => {
    expect(getFirstTextLine(text)).toBe(expected)
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['an empty string', ''],
    ['whitespace and empty blocks', ' <p> </p><br>\n'],
    ['zero-width and format characters only', '\u200b\u200d\u2060\u00ad'],
    ['a lone combining mark', '\u0301'],
    ['zero-width characters split by a space', '\u200b \u200b'],
    ['a Hangul choseong filler', '\u115f'],
    ['a Hangul jungseong filler', '\u1160'],
    ['a blank Braille pattern', '\u2800'],
    ['a Hangul filler', '\u3164'],
    ['a halfwidth Hangul filler', '\uffa0']
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

  it.each([
    { description: 'an emoji-only warning', postSummary: '⚠️', title: '⚠️' },
    {
      description: 'a warning of several emoji',
      postSummary: '❤️ 🔥',
      title: '❤️ 🔥'
    },
    {
      description: 'a warning that opens with an emoji',
      postSummary: '⚠️ Spoiler',
      title: 'Spoiler'
    },
    {
      description: 'a warning with no plain text',
      postSummary: '<script>alert(1)</script>',
      title: CONTENT_WARNING_TITLE
    },
    {
      description: 'a zero-width-only warning',
      postSummary: '\u200b',
      title: CONTENT_WARNING_TITLE
    },
    {
      description: 'a zero-width entity warning',
      postSummary: '&#8203;',
      title: CONTENT_WARNING_TITLE
    },
    {
      description: 'a warning with an invisible first line',
      postSummary: '\u200b\nSpoiler',
      title: 'Spoiler'
    },
    {
      description: 'a long zero-width-only warning',
      postSummary: '\u200b'.repeat(MAX_ACTIVITY_TITLE_LENGTH + 5),
      title: CONTENT_WARNING_TITLE
    },
    {
      description: 'a warning after a long invisible run',
      postSummary: `${'\u200b'.repeat(MAX_ACTIVITY_TITLE_LENGTH + 80)}X`,
      title: 'X'
    },
    {
      description: 'an emoji-only line after a long invisible line',
      postSummary: `${'\u200b'.repeat(MAX_ACTIVITY_TITLE_LENGTH + 80)}\n⚠️`,
      title: '⚠️'
    },
    {
      description: 'a zero-width and space warning',
      postSummary: '\u200b \u200b',
      title: CONTENT_WARNING_TITLE
    },
    {
      description: 'a Hangul filler warning',
      postSummary: '\u3164',
      title: CONTENT_WARNING_TITLE
    }
  ])(
    'never shows the hidden body for $description',
    ({ postSummary, title }) => {
      expect(
        getActivityTitle({
          postSummary,
          postText: '<p>Knee details</p>',
          description: 'From the watch',
          fileName
        })
      ).toBe(title)
    }
  )

  it('truncates a long emoji-only warning at the limit', () => {
    const title = getActivityTitle({
      postSummary: '⚠️'.repeat(MAX_ACTIVITY_TITLE_LENGTH),
      postText: '<p>Knee details</p>',
      fileName
    })
    expect(Array.from(title)).toHaveLength(MAX_ACTIVITY_TITLE_LENGTH)
    expect(title.endsWith('…')).toBe(true)
    expect(title).not.toContain('Knee')
  })

  it.each([
    { description: 'whitespace only', postSummary: '   ' },
    { description: 'empty', postSummary: '' },
    { description: 'null', postSummary: null }
  ])('reads the body when the warning is $description', ({ postSummary }) => {
    expect(
      getActivityTitle({
        postSummary,
        postText: '<p>Knee details</p>',
        fileName
      })
    ).toBe('Knee details')
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
