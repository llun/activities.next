import { vi } from 'vitest'

import { Attachment } from '@/lib/types/domain/attachment'
import { Status, StatusNote, StatusType } from '@/lib/types/domain/status'

// jsdom has no ResizeObserver. useMediaStripScroll already no-ops when it is
// undefined, but the strip still calls `measure()` eagerly on mount, so a
// stub keeps that path exercised the same way it would run in a browser.
export let resizeCallbacks: (() => void)[] = []
export let observedElements: Element[] = []
export let createdObservers = 0
export let disconnectedObservers = 0
export const captionHeights = new Map<string, number>()

class ResizeObserverStub {
  private readonly callback: () => void

  constructor(callback: () => void) {
    createdObservers += 1
    this.callback = callback
    resizeCallbacks.push(callback)
  }

  observe(element: Element) {
    observedElements.push(element)
  }
  unobserve() {}
  disconnect() {
    disconnectedObservers += 1
    resizeCallbacks = resizeCallbacks.filter(
      (callback) => callback !== this.callback
    )
  }
}

// Called from each test file's beforeEach.
export const resetAttachmentTestState = () => {
  resizeCallbacks = []
  observedElements = []
  createdObservers = 0
  disconnectedObservers = 0
  captionHeights.clear()
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(
    function (this: HTMLElement) {
      return captionHeights.get(this.textContent ?? '') ?? 0
    }
  )
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
}

export const currentTime = new Date('2026-04-26T10:00:00.000Z').getTime()

// Enough for `Media` to take its blurhash branch, which is the one every
// locally uploaded image actually renders through.
export const BLURHASH = 'LEHV6nWB2yk8pyo0adR*.7kCMdnj'

let attachmentSequence = 0

export const buildAttachment = (
  overrides: Partial<Attachment> = {}
): Attachment => {
  attachmentSequence += 1
  return {
    id: `attachment-${attachmentSequence}`,
    actorId: 'https://activities.local/users/llun',
    statusId: 'https://activities.local/users/llun/statuses/post-1',
    type: 'Document',
    mediaType: 'image/jpeg',
    url: `https://activities.local/media/${attachmentSequence}.jpg`,
    name: '',
    createdAt: currentTime,
    updatedAt: currentTime,
    ...overrides
  }
}

export const buildNoteStatus = (attachments: Attachment[]): StatusNote => ({
  id: 'https://activities.local/users/llun/statuses/post-1',
  actorId: 'https://activities.local/users/llun',
  actor: {
    id: 'https://activities.local/users/llun',
    username: 'llun',
    domain: 'activities.local',
    name: 'Llun',
    followersUrl: 'https://activities.local/users/llun/followers',
    inboxUrl: 'https://activities.local/users/llun/inbox',
    sharedInboxUrl: 'https://activities.local/inbox',
    followingCount: 0,
    followersCount: 0,
    statusCount: 0,
    lastStatusAt: null,
    createdAt: currentTime
  },
  to: [],
  cc: [],
  edits: [],
  isLocalActor: true,
  createdAt: currentTime,
  updatedAt: currentTime,
  type: StatusType.enum.Note,
  url: 'https://activities.local/@llun/post-1',
  text: 'Status text',
  summary: null,
  reply: '',
  replies: [],
  actorAnnounceStatusId: null,
  isActorLiked: false,
  isActorBookmarked: false,
  totalLikes: 0,
  totalShares: 0,
  attachments,
  tags: []
})

export const buildAnnounceStatus = (originalStatus: StatusNote): Status => ({
  id: 'https://remote.example/users/booster/statuses/boost-1/activity',
  actorId: 'https://remote.example/users/booster',
  actor: null,
  to: [],
  cc: [],
  edits: [],
  isLocalActor: false,
  createdAt: currentTime,
  updatedAt: currentTime,
  type: StatusType.enum.Announce,
  originalStatus
})
