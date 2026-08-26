import {
  getYouTubeEmbedUrl,
  getYouTubePosterUrl,
  getYouTubeVideoFromUrl
} from '@/lib/utils/youtube'

const VIDEO_ID = 'dQw4w9WgXcQ'

describe('getYouTubeVideoFromUrl', () => {
  it.each([
    {
      description: 'reads a watch url',
      input: `https://www.youtube.com/watch?v=${VIDEO_ID}`,
      expected: { videoId: VIDEO_ID }
    },
    {
      description: 'reads a watch url on the bare host',
      input: `https://youtube.com/watch?v=${VIDEO_ID}`,
      expected: { videoId: VIDEO_ID }
    },
    {
      description: 'reads a watch url on the mobile host',
      input: `https://m.youtube.com/watch?v=${VIDEO_ID}`,
      expected: { videoId: VIDEO_ID }
    },
    {
      description: 'reads a watch url on the music host',
      input: `https://music.youtube.com/watch?v=${VIDEO_ID}`,
      expected: { videoId: VIDEO_ID }
    },
    {
      // A link into a playlist still names one video to play; the list is
      // dropped because the embed plays that video alone.
      description: 'plays the named video of a watch url inside a playlist',
      input: `https://www.youtube.com/watch?v=${VIDEO_ID}&list=PLabcdefghij`,
      expected: { videoId: VIDEO_ID }
    },
    {
      description: 'reads a short link',
      input: `https://youtu.be/${VIDEO_ID}`,
      expected: { videoId: VIDEO_ID }
    },
    {
      description: 'reads a short link with a trailing slash',
      input: `https://youtu.be/${VIDEO_ID}/`,
      expected: { videoId: VIDEO_ID }
    },
    {
      description: 'reads a shorts url',
      input: `https://www.youtube.com/shorts/${VIDEO_ID}`,
      expected: { videoId: VIDEO_ID }
    },
    {
      description: 'reads a live url',
      input: `https://www.youtube.com/live/${VIDEO_ID}?feature=share`,
      expected: { videoId: VIDEO_ID }
    },
    {
      description: 'reads an embed url',
      input: `https://www.youtube.com/embed/${VIDEO_ID}`,
      expected: { videoId: VIDEO_ID }
    },
    {
      description: 'reads an embed url on the nocookie host',
      input: `https://www.youtube-nocookie.com/embed/${VIDEO_ID}`,
      expected: { videoId: VIDEO_ID }
    },
    {
      description: 'reads an embed url on the bare nocookie host',
      input: `https://youtube-nocookie.com/embed/${VIDEO_ID}`,
      expected: { videoId: VIDEO_ID }
    },
    {
      description: 'reads a watch url served over http',
      input: `http://www.youtube.com/watch?v=${VIDEO_ID}`,
      expected: { videoId: VIDEO_ID }
    },
    {
      description: 'keeps a start time given in seconds',
      input: `https://youtu.be/${VIDEO_ID}?t=43`,
      expected: { videoId: VIDEO_ID, startSeconds: 43 }
    },
    {
      description: 'keeps a start time given with a seconds suffix',
      input: `https://www.youtube.com/watch?v=${VIDEO_ID}&t=90s`,
      expected: { videoId: VIDEO_ID, startSeconds: 90 }
    },
    {
      description: 'keeps a start time given in hours, minutes and seconds',
      input: `https://www.youtube.com/watch?v=${VIDEO_ID}&t=1h2m3s`,
      expected: { videoId: VIDEO_ID, startSeconds: 3723 }
    },
    {
      description: 'keeps a start time given in minutes alone',
      input: `https://www.youtube.com/watch?v=${VIDEO_ID}&t=2m`,
      expected: { videoId: VIDEO_ID, startSeconds: 120 }
    },
    {
      description: 'keeps a start time given in hours alone',
      input: `https://www.youtube.com/watch?v=${VIDEO_ID}&t=1h`,
      expected: { videoId: VIDEO_ID, startSeconds: 3600 }
    },
    {
      description: 'reads the embed player start parameter',
      input: `https://www.youtube.com/embed/${VIDEO_ID}?start=30`,
      expected: { videoId: VIDEO_ID, startSeconds: 30 }
    },
    {
      // `t` is the one a human chose when sharing; `start` is the player's own.
      description: 'prefers the shared timestamp over the player start',
      input: `https://www.youtube.com/watch?v=${VIDEO_ID}&t=10&start=99`,
      expected: { videoId: VIDEO_ID, startSeconds: 10 }
    }
  ])('$description', ({ input, expected }) => {
    expect(getYouTubeVideoFromUrl(input)).toEqual(expected)
  })

  // A start time is decoration. An unusable one drops to "play from the
  // beginning" rather than costing the reader the player.
  it.each([
    {
      description: 'ignores a start time that is not a duration',
      input: `https://www.youtube.com/watch?v=${VIDEO_ID}&t=abc`
    },
    {
      description: 'ignores a negative start time',
      input: `https://www.youtube.com/watch?v=${VIDEO_ID}&t=-30`
    },
    {
      description: 'ignores an empty start time',
      input: `https://www.youtube.com/watch?v=${VIDEO_ID}&t=`
    },
    {
      description: 'ignores a zero start time',
      input: `https://www.youtube.com/watch?v=${VIDEO_ID}&t=0`
    },
    {
      description: 'ignores a start time longer than any video',
      input: `https://www.youtube.com/watch?v=${VIDEO_ID}&t=999999999`
    },
    {
      description: 'ignores a non-numeric player start parameter',
      input: `https://www.youtube.com/embed/${VIDEO_ID}?start=abc`
    }
  ])('$description', ({ input }) => {
    expect(getYouTubeVideoFromUrl(input)).toEqual({ videoId: VIDEO_ID })
  })

  it.each([
    {
      description: 'rejects a watch url with no video',
      input: 'https://www.youtube.com/watch'
    },
    {
      description: 'rejects an id that is too short',
      input: 'https://www.youtube.com/watch?v=dQw4w9WgXc'
    },
    {
      description: 'rejects an id that is too long',
      input: 'https://www.youtube.com/watch?v=dQw4w9WgXcQQ'
    },
    {
      description: 'rejects an id with characters outside base64url',
      input: 'https://www.youtube.com/watch?v=dQw4w9WgXc!'
    },
    {
      description: 'rejects a percent-encoded id',
      input: 'https://www.youtube.com/embed/%2E%2E%2F%2E%2E%2Fx'
    },
    {
      description: 'rejects a playlist url',
      input: 'https://www.youtube.com/playlist?list=PLabcdefghij'
    },
    {
      // Eleven lowercase letters, so it passes the id shape — and embeds a
      // whole playlist rather than a video.
      description: 'rejects the playlist embed pseudo-id',
      input: 'https://www.youtube.com/embed/videoseries?list=PLabcdefghij'
    },
    {
      description: 'rejects a channel url',
      input: 'https://www.youtube.com/channel/UCabcdefghij'
    },
    {
      description: 'rejects a handle url',
      input: 'https://www.youtube.com/@handle'
    },
    {
      description: 'rejects a search url',
      input: `https://www.youtube.com/results?search_query=${VIDEO_ID}`
    },
    {
      description: 'rejects a feed url',
      input: 'https://www.youtube.com/feed/subscriptions'
    },
    {
      description: 'rejects a path that only starts with watch',
      input: `https://www.youtube.com/watch/extra?v=${VIDEO_ID}`
    },
    {
      description: 'rejects a short link with no video',
      input: 'https://youtu.be/'
    },
    {
      description: 'rejects a short link with extra path segments',
      input: `https://youtu.be/${VIDEO_ID}/extra`
    },
    {
      description: 'rejects an unrelated host',
      input: `https://example.com/watch?v=${VIDEO_ID}`
    },
    {
      // The real host as a PREFIX of the actual one — matching by suffix or
      // substring would hand this an embed.
      description: 'rejects a host that only begins with the youtube host',
      input: `https://youtube.com.evil.example/watch?v=${VIDEO_ID}`
    },
    {
      description: 'rejects a host that only ends with the youtube host',
      input: `https://notyoutube.com/watch?v=${VIDEO_ID}`
    },
    {
      description: 'rejects a subdomain that is not a known youtube host',
      input: `https://evil.youtube.com.example.test/watch?v=${VIDEO_ID}`
    },
    {
      description: 'rejects an uppercased video parameter',
      input: `https://www.youtube.com/watch?V=${VIDEO_ID}`
    },
    {
      description: 'rejects a non-http protocol',
      input: `ftp://www.youtube.com/watch?v=${VIDEO_ID}`
    },
    {
      description: 'rejects a javascript url',
      input: 'javascript:alert(1)'
    },
    {
      description: 'rejects a string that is not a url',
      input: 'not a url'
    },
    {
      description: 'rejects an empty string',
      input: ''
    }
  ])('$description', ({ input }) => {
    expect(getYouTubeVideoFromUrl(input)).toBeNull()
  })
})

describe('getYouTubeEmbedUrl', () => {
  // The player is only ever framed from the cookie-light host, which is also
  // the single origin the app's CSP allows in a frame.
  it('builds the player url on the nocookie host', () => {
    const url = new URL(getYouTubeEmbedUrl({ videoId: VIDEO_ID }))

    expect(url.origin).toBe('https://www.youtube-nocookie.com')
    expect(url.pathname).toBe(`/embed/${VIDEO_ID}`)
  })

  it('plays inline rather than taking over the screen', () => {
    const url = new URL(getYouTubeEmbedUrl({ videoId: VIDEO_ID }))

    expect(url.searchParams.get('playsinline')).toBe('1')
    expect(url.searchParams.get('rel')).toBe('0')
  })

  // A player mounted without a reader's gesture must not carry autoplay.
  it('does not autoplay unless asked', () => {
    const url = new URL(getYouTubeEmbedUrl({ videoId: VIDEO_ID }))

    expect(url.searchParams.get('autoplay')).toBeNull()
  })

  it('autoplays when asked', () => {
    const url = new URL(
      getYouTubeEmbedUrl({ videoId: VIDEO_ID }, { autoplay: true })
    )

    expect(url.searchParams.get('autoplay')).toBe('1')
  })

  it('carries the start time when there is one', () => {
    const url = new URL(
      getYouTubeEmbedUrl({ videoId: VIDEO_ID, startSeconds: 3723 })
    )

    expect(url.searchParams.get('start')).toBe('3723')
  })

  it('omits the start time when there is none', () => {
    const url = new URL(getYouTubeEmbedUrl({ videoId: VIDEO_ID }))

    expect(url.searchParams.get('start')).toBeNull()
  })

  // The parser validates the id, but the builder is exported on its own and
  // must not splice an unvalidated one into the path.
  it('encodes a video id that did not come from the parser', () => {
    const url = new URL(getYouTubeEmbedUrl({ videoId: '../../evil?x=1' }))

    expect(url.origin).toBe('https://www.youtube-nocookie.com')
    expect(url.pathname).toBe('/embed/..%2F..%2Fevil%3Fx%3D1')
  })
})

describe('getYouTubePosterUrl', () => {
  // hqdefault is generated for every video; maxresdefault 404s for anything
  // never uploaded above 720p.
  it('points at the thumbnail that exists for every video', () => {
    expect(getYouTubePosterUrl({ videoId: VIDEO_ID })).toBe(
      `https://i.ytimg.com/vi/${VIDEO_ID}/hqdefault.jpg`
    )
  })

  it('encodes a video id that did not come from the parser', () => {
    expect(getYouTubePosterUrl({ videoId: '../evil' })).toBe(
      'https://i.ytimg.com/vi/..%2Fevil/hqdefault.jpg'
    )
  })
})
