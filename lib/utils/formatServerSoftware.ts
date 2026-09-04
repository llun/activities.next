import type { ServerSoftware } from '@/lib/services/federation/serverSoftware'

const KNOWN_SOFTWARE_NAMES: Record<string, string> = {
  mastodon: 'Mastodon',
  pixelfed: 'Pixelfed',
  gotosocial: 'GoToSocial',
  lemmy: 'Lemmy',
  peertube: 'PeerTube',
  misskey: 'Misskey',
  firefish: 'Firefish',
  sharkey: 'Sharkey',
  akkoma: 'Akkoma',
  pleroma: 'Pleroma',
  bookwyrm: 'BookWyrm',
  wordpress: 'WordPress',
  'activities.next': 'activities.next',
  'activities-next': 'activities.next',
  friendica: 'Friendica',
  hubzilla: 'Hubzilla',
  diaspora: 'Diaspora',
  threads: 'Threads',
  'micro.blog': 'Micro.blog',
  microdotblog: 'Micro.blog'
}

export const formatServerSoftware = (software: ServerSoftware): string => {
  const rawName = software.name.trim()
  if (!rawName) return ''

  const lookupKey = rawName.toLowerCase()
  const formattedName = Object.hasOwn(KNOWN_SOFTWARE_NAMES, lookupKey)
    ? KNOWN_SOFTWARE_NAMES[lookupKey]
    : rawName.charAt(0).toUpperCase() + rawName.slice(1)

  const trimmedVersion = software.version?.trim()
  if (trimmedVersion) {
    return `${formattedName}/${trimmedVersion}`
  }

  return formattedName
}
