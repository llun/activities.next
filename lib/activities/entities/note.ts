import { Note } from '@llun/activities.schema'

export const getAttachments = (object: Note) => {
  if (!object.attachment) return []
  if (Array.isArray(object.attachment)) return object.attachment
  return [object.attachment]
}

export const getTags = (object: Note) => {
  if (!object.tag) return []
  if (Array.isArray(object.tag)) return object.tag
  return [object.tag]
}

export const getContent = (object: Note) => {
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

export const getSummary = (object: Note) => {
  if (object.summary) return object.summary
  if (object.summaryMap) {
    const keys = Object.keys(object.summaryMap)
    if (keys.length === 0) return ''

    const key = Object.keys(object.summaryMap)[0]
    return object.summaryMap[key]
  }
  return ''
}
