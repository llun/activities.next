export const HASHTAG_REGEX =
  /(?:^|[\s>])#([a-zA-Z0-9_]*[a-zA-Z_][a-zA-Z0-9_]*)/g

interface ExtractedHashtag {
  name: string
  value: string
}

export const getHashtags = (text: string, host: string): ExtractedHashtag[] => {
  const seen = new Set<string>()
  const hashtags: ExtractedHashtag[] = []
  for (const match of text.matchAll(HASHTAG_REGEX)) {
    const tag = match[1]
    const lower = tag.toLowerCase()
    if (seen.has(lower)) continue
    seen.add(lower)
    hashtags.push({
      name: `#${tag}`,
      value: `https://${host}/tags/${lower}`
    })
  }
  return hashtags
}
