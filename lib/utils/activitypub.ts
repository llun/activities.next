const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const extractActivityPubId = (value: unknown): string | undefined => {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    for (const item of value) {
      const id = extractActivityPubId(item)
      if (id) return id
    }
    return
  }
  if (!isRecord(value)) return
  if (typeof value.id === 'string') return value.id
  if (typeof value.href === 'string') return value.href
  if (typeof value.url === 'string') return value.url
  return
}

export const normalizeActivityPubRecipients = (
  value: unknown
): string | string[] | undefined => {
  if (Array.isArray(value)) {
    const items = value
      .map((item) => extractActivityPubId(item))
      .filter((item): item is string => Boolean(item))
    return items.length ? items : undefined
  }
  return extractActivityPubId(value)
}

export const normalizeActivityPubAnnounce = (data: unknown) => {
  if (!isRecord(data)) return data
  return {
    ...data,
    actor: extractActivityPubId(data.actor) ?? data.actor,
    object: extractActivityPubId(data.object) ?? data.object,
    to: normalizeActivityPubRecipients(data.to) ?? data.to,
    cc: normalizeActivityPubRecipients(data.cc) ?? data.cc
  }
}

export const normalizeActivityPubContent = (data: unknown) => {
  if (!isRecord(data)) return data
  return {
    ...data,
    attributedTo: extractActivityPubId(data.attributedTo) ?? data.attributedTo,
    inReplyTo: extractActivityPubId(data.inReplyTo) ?? data.inReplyTo,
    url: extractActivityPubId(data.url) ?? data.url,
    to: normalizeActivityPubRecipients(data.to) ?? data.to,
    cc: normalizeActivityPubRecipients(data.cc) ?? data.cc
  }
}
