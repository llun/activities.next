import { z } from 'zod'

interface Derivative {
  fileSize: string
  checksum: string
  width: string
  height: string
  state?: string
}

interface Media {
  batchGuid: string
  derivatives: {
    [key: string]: Derivative
  }
  contributorLastName: string
  batchDateCreated: string
  dateCreated: string
  contributorFirstName: string
  photoGuid: string
  contributorFullName: string
  caption: string
}

interface Image extends Media {
  width: number
  height: number
}

interface Video extends Media {
  mediaAssetType: 'video'
}

type Photo = Video | Image

export interface Stream {
  userLastName: string
  streamCtag: string
  itemsReturned: number
  userFirstName: string
  streamName: string
  photos: Photo[]
}

export const Assets = z.object({
  items: z.record(
    z.object({
      url_expiry: z.string(),
      url_location: z.string(),
      url_path: z.string()
    })
  ),
  locations: z.record(
    z.object({
      hosts: z.string().array(),
      scheme: z.string()
    })
  )
})

export type Assets = z.infer<typeof Assets>

export const VideoPosterDerivative = 'PosterFrame'
export const Video720p = '720p'
export const Video360p = '360p'

const Base62Charset =
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

const base62ToInt = (input: string) =>
  Array.from(input).reduce(
    (result, char) => result * 62 + Base62Charset.indexOf(char),
    0
  )

function getPartitionFromToken(token: string) {
  const serverPartition =
    token[0] === 'A'
      ? base62ToInt(token[1])
      : base62ToInt(token.substring(1, 3))
  if (serverPartition < 10) return `0${serverPartition}`
  return serverPartition
}

function getStreamBaseUrl(token: string) {
  const partition = getPartitionFromToken(token)
  return `https://p${partition}-sharedstreams.icloud.com`
}

/**
 * Fetch all media information from public iCloud Shared Album
 *
 * @param token shared album id, this is the string after hash e.g.
 *  https://www.icloud.com/sharedalbum/#B125ON9t3mbLNC id is B125ON9t3mbLNC
 */
export async function fetchStream(token: string): Promise<Stream | null> {
  // Fetch is used here instead of request in utils because this library uses in the browser.
  const response = await fetch(
    `${getStreamBaseUrl(token)}/${token}/sharedstreams/webstream`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
        'Cache-Control': 'no-cache'
      },
      body: JSON.stringify({ streamCtag: null })
    }
  )
  if (response.status !== 200) return null
  return response.json()
}

export async function fetchAssetsUrl(
  token: string,
  photoGuids: string[]
): Promise<Assets | null> {
  // Fetch is used here instead of request in utils because this library uses in the browser.
  const response = await fetch(
    `${getStreamBaseUrl(token)}/${token}/sharedstreams/webasseturls`,
    {
      headers: {
        'cache-control': 'no-cache',
        'content-type': 'text/plain',
        pragma: 'no-cache'
      },
      body: JSON.stringify({ photoGuids }),
      method: 'POST'
    }
  )
  if (response.status !== 200) return null

  try {
    return Assets.parse(await response.json())
  } catch {
    return null
  }
}
