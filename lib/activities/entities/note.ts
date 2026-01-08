import {
  ArticleContent,
  ImageContent,
  Note,
  PageContent,
  VideoContent
} from '@llun/activities.schema'

export type BaseNote =
  | Note
  | ImageContent
  | PageContent
  | ArticleContent
  | VideoContent

export const getUrl = (url: string | any | any[]): string | undefined => {
  if (Array.isArray(url)) {
    const first = url[0]
    if (typeof first === 'string') return first
    return first?.href
  }
  if (typeof url === 'string') return url
  return url?.href
}

export const getReply = (reply: string | any): string | undefined => {
  if (typeof reply === 'string') return reply
  return reply?.id
}

export const getAttachments = (object: BaseNote) => {
  const attachments = []
  if (object.attachment) {
    if (Array.isArray(object.attachment)) {
      attachments.push(...object.attachment)
    } else {
      attachments.push(object.attachment)
    }
  }

  if (['Image', 'Video'].includes(object.type)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const unsafeObject = object as any
    const url = getUrl(unsafeObject.url)
    if (url) {
      attachments.push({
        type: 'Document',
        mediaType:
          unsafeObject.mediaType ||
          (object.type === 'Image' ? 'image/jpeg' : 'video/mp4'),
        url,
        name: unsafeObject.name,
        width: unsafeObject.width,
        height: unsafeObject.height,
        blurhash: unsafeObject.blurhash
      })
    }
  }
  return attachments
}

export const getTags = (object: BaseNote) => {
  if (!object.tag) return []
  if (Array.isArray(object.tag)) return object.tag
  return [object.tag]
}

export const getContent = (object: BaseNote) => {
  if (object.content) {
    // Wordpress uses array in contentMap instead of locale map.
    // This is a temporary fixed to support it.
    if (Array.isArray(object.content)) {
      return object.content[0]
    }
    return object.content
  }

  if (object.contentMap) {
    if (Array.isArray(object.contentMap)) {
      return object.contentMap[0]
    }

    const keys = Object.keys(object.contentMap)
    if (keys.length === 0) return ''

    const key = Object.keys(object.contentMap)[0]
    return object.contentMap[key]
  }
  return ''
}

export const getSummary = (object: BaseNote) => {
  if (object.summary) return object.summary
  if (object.summaryMap) {
    const keys = Object.keys(object.summaryMap)
    if (keys.length === 0) return ''

    const key = Object.keys(object.summaryMap)[0]
    return object.summaryMap[key]
  }
  return ''
}
