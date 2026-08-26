/**
 * Recognising a YouTube video from a URL, and building the embed and poster
 * URLs for it.
 *
 * This is deliberately a pure function of the URL and nothing else. The link
 * preview card it serves carries remote, page-authored metadata (`og:type`,
 * `og:site_name`, an `og:image` of the page's choosing), and none of it decides
 * whether a player is rendered: `link_previews.url` is the redirect-resolved
 * final URL the server itself fetched, so a page can only be treated as YouTube
 * by actually being served from a YouTube host. Every id that reaches an embed
 * URL has been through `VIDEO_ID_PATTERN` first.
 */

// Matched EXACTLY, never by suffix — `youtube.com.evil.example` and
// `notyoutube.com` both end/contain the real host as a substring, and either
// would otherwise mint an embed URL for an attacker-chosen id.
const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com'
])

// The short-link host addresses a video by its whole path, so it is matched
// separately from the hosts that use `/watch?v=` and the `/shorts|live|embed`
// prefixes.
const YOUTU_BE_HOST = 'youtu.be'

// The path prefixes that address a single video by its id.
const VIDEO_PATH_PREFIXES = new Set(['shorts', 'live', 'embed'])

// A video id is 11 characters of base64url. Percent-encoding cannot survive
// this (a `%` is not in the class), so an encoded path segment fails closed
// rather than being decoded into something else.
const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/

// `/embed/videoseries?list=…` embeds a PLAYLIST, not a video — and
// "videoseries" is eleven lowercase letters, so it passes VIDEO_ID_PATTERN and
// would otherwise be embedded as if it were an id.
const PLAYLIST_EMBED_SEGMENT = 'videoseries'

// `1h2m3s`, `90s`, `2m`, `1h`, or bare seconds. Every group is optional, so the
// empty string matches too and yields 0 — which is discarded below along with
// every other falsy total.
const TIMESTAMP_PATTERN = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/

// ~100 hours. A start time is a nicety, so anything beyond the length of any
// real video is dropped rather than passed to the player.
const MAX_START_SECONDS = 359_999

const EMBED_ORIGIN = 'https://www.youtube-nocookie.com'
const POSTER_ORIGIN = 'https://i.ytimg.com'

export type YouTubeVideo = {
  /** Always matches `VIDEO_ID_PATTERN`. */
  videoId: string
  /** Whole seconds, 1..MAX_START_SECONDS. Absent when there is no usable one. */
  startSeconds?: number
}

const getStartSeconds = (searchParams: URLSearchParams) => {
  // `t` is what a "copy link at current time" share writes and what a reader
  // pastes; `start` is the embed player's own parameter and only ever bare
  // seconds. A URL carrying both is answered by `t`, the one a human chose.
  const timestamp = searchParams.get('t')?.trim()
  const start = searchParams.get('start')?.trim()

  const raw = timestamp || start
  if (!raw) return undefined

  const match = TIMESTAMP_PATTERN.exec(raw)
  if (!match) return undefined

  const [, hours, minutes, seconds] = match
  const total =
    Number(hours ?? 0) * 3600 + Number(minutes ?? 0) * 60 + Number(seconds ?? 0)

  // 0 is "from the beginning", which is where the player starts anyway, so it
  // is carried as an absent start rather than an explicit one.
  if (!total || total > MAX_START_SECONDS) return undefined

  return total
}

const getVideoIdFromYouTubeHost = (url: URL, segments: string[]) => {
  // `/watch` and nothing after it — `/watch/anything` is a different route and
  // must not be read as a watch page.
  if (segments.length === 1 && segments[0] === 'watch') {
    return url.searchParams.get('v')
  }

  if (segments.length === 2 && VIDEO_PATH_PREFIXES.has(segments[0])) {
    if (segments[0] === 'embed' && segments[1] === PLAYLIST_EMBED_SEGMENT) {
      return null
    }
    return segments[1]
  }

  return null
}

/**
 * The video a URL addresses, or `null` for anything that is not one — another
 * host, a playlist, a channel, a search, a malformed id. Callers treat `null`
 * as "this is an ordinary link".
 */
export const getYouTubeVideoFromUrl = (url: string): YouTubeVideo | null => {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }

  // Stored preview URLs are http(s) already; this keeps a `javascript:` or
  // `data:` URL from ever reaching the id parse.
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null

  // `URL` lowercases the host for us, so the exact-match set needs no folding.
  const { hostname } = parsed
  const isShortLink = hostname === YOUTU_BE_HOST
  if (!isShortLink && !YOUTUBE_HOSTS.has(hostname)) return null

  // Splitting on `/` and dropping the empties makes a trailing slash
  // insignificant while keeping `/a/b` distinguishable from `/a`.
  const segments = parsed.pathname.split('/').filter(Boolean)

  const videoId = isShortLink
    ? segments.length === 1
      ? segments[0]
      : null
    : getVideoIdFromYouTubeHost(parsed, segments)

  if (!videoId || !VIDEO_ID_PATTERN.test(videoId)) return null

  const startSeconds = getStartSeconds(parsed.searchParams)

  return startSeconds ? { videoId, startSeconds } : { videoId }
}

/**
 * The player URL for a video, always on the cookie-light `youtube-nocookie.com`
 * host — the single origin this app's CSP allows in a frame.
 */
export const getYouTubeEmbedUrl = (
  video: YouTubeVideo,
  options: { autoplay?: boolean } = {}
) => {
  // The id is validated at parse time; encoding it as well means a hand-built
  // `YouTubeVideo` still cannot splice anything into the path.
  const url = new URL(
    `${EMBED_ORIGIN}/embed/${encodeURIComponent(video.videoId)}`
  )
  // Without this iOS Safari takes any playback fullscreen, which is not what a
  // reader who pressed play inside a timeline asked for.
  url.searchParams.set('playsinline', '1')
  url.searchParams.set('rel', '0')
  if (video.startSeconds) {
    url.searchParams.set('start', String(video.startSeconds))
  }
  // Only ever set for a player mounted BY a reader's click: the gesture is what
  // makes autoplay legitimate, and a player that mounts without one must not
  // carry it.
  if (options.autoplay) url.searchParams.set('autoplay', '1')

  return url.toString()
}

/**
 * The thumbnail YouTube serves for a video. `hqdefault` is the largest size
 * generated for every video — `maxresdefault` is absent for anything never
 * uploaded above 720p and answers 404 — so this is the one that can be shown
 * without a fallback of its own.
 */
export const getYouTubePosterUrl = (video: YouTubeVideo) =>
  `${POSTER_ORIGIN}/vi/${encodeURIComponent(video.videoId)}/hqdefault.jpg`
