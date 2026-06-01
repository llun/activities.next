'use client'

import {
  Archive,
  ArrowLeft,
  Loader2,
  Plus,
  Search,
  Send,
  X
} from 'lucide-react'
import {
  FC,
  FormEvent,
  KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'

import {
  createDirectMessage,
  getConversationStatuses,
  getConversations,
  hideConversation,
  markConversationRead,
  searchAccounts
} from '@/lib/client'
import type { DirectConversationView } from '@/lib/client'
import { MediasModal } from '@/lib/components/medias-modal/medias-modal'
import { PageHeader } from '@/lib/components/page-header'
import { Avatar, AvatarFallback, AvatarImage } from '@/lib/components/ui/avatar'
import { Button } from '@/lib/components/ui/button'
import { Input } from '@/lib/components/ui/input'
import { Textarea } from '@/lib/components/ui/textarea'
import { ActorProfile } from '@/lib/types/domain/actor'
import { Attachment } from '@/lib/types/domain/attachment'
import { Status } from '@/lib/types/domain/status'
import type { Account as MastodonAccount } from '@/lib/types/mastodon/account'
import { cn } from '@/lib/utils'
import { htmlToPlainText } from '@/lib/utils/text/htmlToPlainText'

import { MessageBubble } from './MessageBubble'
import { INITIAL_CONVERSATIONS_LIMIT } from './constants'

interface MessagesPageProps {
  host: string
  conversations: DirectConversationView[]
  initialConversationId: string | null
  initialStatuses: Status[]
  initialNextMaxStatusId: string | null
  currentActor: ActorProfile
  initialHasMoreConversations?: boolean
}

interface ConversationPreviewCacheEntry {
  key: string
  preview: string
}

const READ_RETRY_COOLDOWN_MS = 30_000
const LOAD_MORE_CONVERSATIONS_LIMIT = 20
const RECIPIENT_SEARCH_DEBOUNCE_MS = 300

const accountLabel = (account: MastodonAccount) =>
  account.display_name || account.acct || account.username

const accountHandle = (account: MastodonAccount) =>
  account.acct.startsWith('@') ? account.acct : `@${account.acct}`

const getInitial = (value: string) => {
  const trimmed = value.trim()
  // Spread to a code-point array so a leading emoji/surrogate pair isn't split.
  return trimmed ? [...trimmed][0].toUpperCase() : '?'
}

const conversationTitle = (conversation: DirectConversationView) => {
  if (conversation.accounts.length === 0) return 'You'
  return conversation.accounts.map(accountLabel).join(', ')
}

const conversationSubtitle = (conversation: DirectConversationView) => {
  if (
    conversation.lastStatus.type === 'Note' ||
    conversation.lastStatus.type === 'Poll'
  ) {
    return htmlToPlainText(conversation.lastStatus.text) || 'Message'
  }
  return 'Message'
}

const conversationSubtitleCacheKey = (conversation: DirectConversationView) => {
  if (
    conversation.lastStatus.type === 'Note' ||
    conversation.lastStatus.type === 'Poll'
  ) {
    return [
      conversation.lastStatus.type,
      conversation.lastStatus.id,
      conversation.lastStatus.text ?? ''
    ].join('\u0000')
  }

  return [conversation.lastStatus.type, conversation.lastStatus.id].join(
    '\u0000'
  )
}

const formatTimestamp = (timestamp: number) =>
  new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(new Date(timestamp))

export const MessagesPage: FC<MessagesPageProps> = ({
  host,
  conversations,
  initialConversationId,
  initialStatuses,
  initialNextMaxStatusId,
  currentActor,
  initialHasMoreConversations = false
}) => {
  const [currentConversations, setCurrentConversations] =
    useState<DirectConversationView[]>(conversations)
  const [selectedConversationId, setSelectedConversationId] = useState<
    string | null
  >(initialConversationId)
  const [threadStatuses, setThreadStatuses] =
    useState<Status[]>(initialStatuses)
  const [nextMaxStatusId, setNextMaxStatusId] = useState<string | null>(
    initialNextMaxStatusId
  )
  const [selectedRecipients, setSelectedRecipients] = useState<
    MastodonAccount[]
  >([])
  const [recipientQuery, setRecipientQuery] = useState('')
  const [recipientSearchResults, setRecipientSearchResults] = useState<
    MastodonAccount[]
  >([])
  const [message, setMessage] = useState('')
  const [isResolvingRecipient, setResolvingRecipient] = useState(false)
  const [isSending, setSending] = useState(false)
  const [isThreadLoading, setThreadLoading] = useState(false)
  const [isLoadingMoreStatuses, setLoadingMoreStatuses] = useState(false)
  const [isLoadingMoreConversations, setLoadingMoreConversations] =
    useState(false)
  const [hasMoreConversations, setHasMoreConversations] = useState(
    initialHasMoreConversations
  )
  const [showConversationListOnMobile, setShowConversationListOnMobile] =
    useState(!initialConversationId)
  const [readRetryNonce, setReadRetryNonce] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [modalMedias, setModalMedias] = useState<{
    medias: Attachment[]
    initialSelection: number
  } | null>(null)
  const latestThreadRequestIdRef = useRef(0)
  const selectedConversationIdRef = useRef(selectedConversationId)
  const threadContainerRef = useRef<HTMLDivElement | null>(null)
  const lastFailedReadAtRef = useRef(new Map<string, number>())
  const pendingReadConversationIdsRef = useRef(new Set<string>())
  const latestReadRequestIdRef = useRef(new Map<string, number>())
  const latestRecipientSearchRequestIdRef = useRef(0)
  const recipientSearchTimeoutRef = useRef<number | null>(null)
  const recipientSearchAbortControllerRef = useRef<AbortController | null>(null)
  const lastAutoScrolledStatusIdRef = useRef<string | null>(null)
  const pendingOlderScrollAnchorRef = useRef<{
    requestId: number
    scrollHeight: number
    scrollTop: number
  } | null>(null)
  const conversationPreviewCacheRef = useRef(
    new Map<string, ConversationPreviewCacheEntry>()
  )

  const selectedConversation = useMemo(
    () =>
      currentConversations.find(
        (conversation) => conversation.id === selectedConversationId
      ) ?? null,
    [currentConversations, selectedConversationId]
  )
  const displayStatuses = useMemo(
    () => [...threadStatuses].reverse(),
    [threadStatuses]
  )
  const conversationPreviewData = useMemo(() => {
    const previousCache = conversationPreviewCacheRef.current
    const nextCache = new Map<string, ConversationPreviewCacheEntry>()
    const previews = new Map<string, string>()

    currentConversations.forEach((conversation) => {
      const cacheKey = conversationSubtitleCacheKey(conversation)
      const cachedPreview = previousCache.get(conversation.id)
      const preview =
        cachedPreview?.key === cacheKey
          ? cachedPreview.preview
          : conversationSubtitle(conversation)

      nextCache.set(conversation.id, { key: cacheKey, preview })
      previews.set(conversation.id, preview)
    })

    return { cache: nextCache, previews }
  }, [currentConversations])
  const conversationPreviews = conversationPreviewData.previews
  const newestDisplayedStatusId =
    displayStatuses[displayStatuses.length - 1]?.id ?? null
  const composerRecipients = selectedConversation
    ? selectedConversation.accounts
    : selectedRecipients
  const headerAccount = composerRecipients[0] ?? null
  const headerTitle = selectedConversation
    ? conversationTitle(selectedConversation)
    : 'New message'

  const clearRecipientSearchTimeout = useCallback(() => {
    if (recipientSearchTimeoutRef.current === null) return
    window.clearTimeout(recipientSearchTimeoutRef.current)
    recipientSearchTimeoutRef.current = null
  }, [])

  const abortRecipientSearch = useCallback(() => {
    recipientSearchAbortControllerRef.current?.abort()
    recipientSearchAbortControllerRef.current = null
  }, [])

  const selectConversation = useCallback(
    (conversationId: string | null) => {
      if (conversationId) {
        setShowConversationListOnMobile(false)
      }
      if (conversationId) {
        const hadFailed = lastFailedReadAtRef.current.delete(conversationId)
        if (hadFailed) setReadRetryNonce((nonce) => nonce + 1)
      }
      if (conversationId === selectedConversationIdRef.current) return
      if (conversationId) {
        clearRecipientSearchTimeout()
        abortRecipientSearch()
        latestRecipientSearchRequestIdRef.current += 1
        setResolvingRecipient(false)
        setSelectedRecipients([])
        setRecipientSearchResults([])
        setRecipientQuery('')
      }
      latestThreadRequestIdRef.current += 1
      selectedConversationIdRef.current = conversationId
      lastAutoScrolledStatusIdRef.current = null
      pendingOlderScrollAnchorRef.current = null
      setSelectedConversationId(conversationId)
    },
    [abortRecipientSearch, clearRecipientSearchTimeout]
  )

  const loadThread = useCallback(
    async (conversationId: string, options: { silent?: boolean } = {}) => {
      const requestId = latestThreadRequestIdRef.current + 1
      latestThreadRequestIdRef.current = requestId
      if (!options.silent) {
        setThreadLoading(true)
      }
      setLoadingMoreStatuses(false)
      try {
        const result = await getConversationStatuses({
          conversationId,
          limit: 40
        })
        if (latestThreadRequestIdRef.current !== requestId) return
        setThreadStatuses(result.statuses)
        setNextMaxStatusId(result.nextMaxStatusId)
      } catch (_error) {
        if (latestThreadRequestIdRef.current === requestId) {
          setError('Could not load messages')
        }
      } finally {
        if (latestThreadRequestIdRef.current === requestId) {
          setThreadLoading(false)
        }
      }
    },
    []
  )

  useEffect(() => {
    const threadContainer = threadContainerRef.current
    if (!threadContainer) return

    const pendingOlderScrollAnchor = pendingOlderScrollAnchorRef.current
    if (
      pendingOlderScrollAnchor &&
      pendingOlderScrollAnchor.requestId === latestThreadRequestIdRef.current
    ) {
      pendingOlderScrollAnchorRef.current = null
      threadContainer.scrollTop =
        pendingOlderScrollAnchor.scrollTop +
        (threadContainer.scrollHeight - pendingOlderScrollAnchor.scrollHeight)
      return
    }

    if (!newestDisplayedStatusId) {
      lastAutoScrolledStatusIdRef.current = null
      return
    }

    if (lastAutoScrolledStatusIdRef.current === newestDisplayedStatusId) return
    lastAutoScrolledStatusIdRef.current = newestDisplayedStatusId
    threadContainer.scrollTop = threadContainer.scrollHeight
  }, [displayStatuses.length, newestDisplayedStatusId])

  const handleMessageKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key !== 'Enter' || event.shiftKey) return

      event.preventDefault()
      event.currentTarget.form?.requestSubmit()
    },
    []
  )

  const loadMoreStatuses = useCallback(async () => {
    if (!selectedConversationId || !nextMaxStatusId) return

    setError(null)
    const requestId = latestThreadRequestIdRef.current + 1
    latestThreadRequestIdRef.current = requestId
    const threadContainer = threadContainerRef.current
    pendingOlderScrollAnchorRef.current = threadContainer
      ? {
          requestId,
          scrollHeight: threadContainer.scrollHeight,
          scrollTop: threadContainer.scrollTop
        }
      : null
    setLoadingMoreStatuses(true)
    let shouldPreserveScroll = false
    try {
      const result = await getConversationStatuses({
        conversationId: selectedConversationId,
        maxStatusId: nextMaxStatusId,
        limit: 40
      })
      if (latestThreadRequestIdRef.current !== requestId) {
        if (pendingOlderScrollAnchorRef.current?.requestId === requestId) {
          pendingOlderScrollAnchorRef.current = null
        }
        return
      }
      const existingStatusIds = new Set(
        threadStatuses.map((status) => status.id)
      )
      shouldPreserveScroll = result.statuses.some(
        (status) => !existingStatusIds.has(status.id)
      )
      setThreadStatuses((previousStatuses) => {
        const seenIds = new Set(previousStatuses.map((status) => status.id))
        const newStatuses = result.statuses.filter(
          (status) => !seenIds.has(status.id)
        )
        return [...previousStatuses, ...newStatuses]
      })
      setNextMaxStatusId(result.nextMaxStatusId)
    } catch (_error) {
      if (latestThreadRequestIdRef.current === requestId) {
        setError('Could not load more messages')
      }
    } finally {
      if (
        !shouldPreserveScroll &&
        pendingOlderScrollAnchorRef.current?.requestId === requestId
      ) {
        pendingOlderScrollAnchorRef.current = null
      }
      if (latestThreadRequestIdRef.current === requestId) {
        setLoadingMoreStatuses(false)
      }
    }
  }, [nextMaxStatusId, selectedConversationId, threadStatuses])

  useEffect(() => {
    selectedConversationIdRef.current = selectedConversationId
  }, [selectedConversationId])

  useEffect(() => {
    conversationPreviewCacheRef.current = conversationPreviewData.cache
  }, [conversationPreviewData])

  useEffect(() => {
    if (!selectedConversationId) {
      latestThreadRequestIdRef.current += 1
      setThreadLoading(false)
      setThreadStatuses([])
      setNextMaxStatusId(null)
      return
    }

    void loadThread(selectedConversationId)
  }, [loadThread, selectedConversationId])

  useEffect(() => {
    if (!selectedConversationId || !selectedConversation?.unread) return
    if (pendingReadConversationIdsRef.current.has(selectedConversationId)) {
      return
    }
    const lastFailedAt =
      lastFailedReadAtRef.current.get(selectedConversationId) ?? 0
    if (Date.now() - lastFailedAt < READ_RETRY_COOLDOWN_MS) {
      return
    }

    const conversationId = selectedConversationId
    const requestId =
      (latestReadRequestIdRef.current.get(conversationId) ?? 0) + 1
    latestReadRequestIdRef.current.set(conversationId, requestId)
    pendingReadConversationIdsRef.current.add(conversationId)
    setCurrentConversations((previousConversations) =>
      previousConversations.map((conversation) =>
        conversation.id === conversationId
          ? { ...conversation, unread: false }
          : conversation
      )
    )

    const isLatestRequest = () =>
      latestReadRequestIdRef.current.get(conversationId) === requestId

    const restoreUnreadState = () => {
      if (!isLatestRequest()) return
      lastFailedReadAtRef.current.set(conversationId, Date.now())
      setError('Could not mark conversation as read')
      setCurrentConversations((previousConversations) =>
        previousConversations.map((conversation) =>
          conversation.id === conversationId
            ? { ...conversation, unread: true }
            : conversation
        )
      )
    }

    void markConversationRead({ conversationId })
      .then((markedRead) => {
        if (!isLatestRequest()) return
        if (markedRead) {
          lastFailedReadAtRef.current.delete(conversationId)
          return
        }
        restoreUnreadState()
      })
      .catch(restoreUnreadState)
      .finally(() => {
        pendingReadConversationIdsRef.current.delete(conversationId)
      })
  }, [selectedConversation?.unread, selectedConversationId, readRetryNonce])

  const refreshConversations = useCallback(async () => {
    const result = await getConversations({
      limit: INITIAL_CONVERSATIONS_LIMIT + 1
    })
    const nextConversations = result.conversations.slice(
      0,
      INITIAL_CONVERSATIONS_LIMIT
    )
    setCurrentConversations(nextConversations)
    setHasMoreConversations(
      result.conversations.length > INITIAL_CONVERSATIONS_LIMIT
    )
    return nextConversations
  }, [])

  const loadMoreConversations = useCallback(async () => {
    const oldestConversation =
      currentConversations[currentConversations.length - 1]
    if (!oldestConversation) return

    setLoadingMoreConversations(true)
    try {
      const result = await getConversations({
        limit: LOAD_MORE_CONVERSATIONS_LIMIT + 1,
        maxId: oldestConversation.id
      })
      const fetchedConversations = result.conversations.slice(
        0,
        LOAD_MORE_CONVERSATIONS_LIMIT
      )
      setCurrentConversations((previousConversations) => {
        const seenIds = new Set(
          previousConversations.map((conversation) => conversation.id)
        )
        const newConversations = fetchedConversations.filter(
          (conversation) => !seenIds.has(conversation.id)
        )
        return [...previousConversations, ...newConversations]
      })
      setHasMoreConversations(
        result.conversations.length > LOAD_MORE_CONVERSATIONS_LIMIT
      )
    } catch (_error) {
      setError('Could not load more conversations')
    } finally {
      setLoadingMoreConversations(false)
    }
  }, [currentConversations])

  const runRecipientSearch = useCallback(
    async (value: string, options: { showNotFoundError?: boolean } = {}) => {
      const query = value.trim()
      if (!query) {
        latestRecipientSearchRequestIdRef.current += 1
        abortRecipientSearch()
        setRecipientSearchResults([])
        setResolvingRecipient(false)
        setError(null)
        return
      }

      const requestId = latestRecipientSearchRequestIdRef.current + 1
      latestRecipientSearchRequestIdRef.current = requestId
      abortRecipientSearch()
      const abortController = new AbortController()
      recipientSearchAbortControllerRef.current = abortController

      setResolvingRecipient(true)
      setError(null)
      try {
        const results = await searchAccounts({
          q: query,
          resolve: true,
          limit: 5,
          signal: abortController.signal
        })
        if (latestRecipientSearchRequestIdRef.current !== requestId) return
        setRecipientSearchResults(results)
        if (results.length === 0 && options.showNotFoundError) {
          setError('Account not found')
        }
      } catch (_error) {
        if (abortController.signal.aborted) return
        if (latestRecipientSearchRequestIdRef.current === requestId) {
          setError('Could not search for account')
        }
      } finally {
        if (recipientSearchAbortControllerRef.current === abortController) {
          recipientSearchAbortControllerRef.current = null
        }
        if (latestRecipientSearchRequestIdRef.current === requestId) {
          setResolvingRecipient(false)
        }
      }
    },
    [abortRecipientSearch]
  )

  const searchForRecipients = useCallback(() => {
    const query = recipientQuery.trim()
    clearRecipientSearchTimeout()
    void runRecipientSearch(query, { showNotFoundError: true })
  }, [clearRecipientSearchTimeout, recipientQuery, runRecipientSearch])

  useEffect(() => {
    const query = recipientQuery.trim()
    latestRecipientSearchRequestIdRef.current += 1
    setRecipientSearchResults([])
    setResolvingRecipient(false)
    setError(null)
    clearRecipientSearchTimeout()
    abortRecipientSearch()

    if (!query) return

    recipientSearchTimeoutRef.current = window.setTimeout(() => {
      recipientSearchTimeoutRef.current = null
      void runRecipientSearch(query, { showNotFoundError: true })
    }, RECIPIENT_SEARCH_DEBOUNCE_MS)

    return () => {
      clearRecipientSearchTimeout()
      abortRecipientSearch()
    }
  }, [
    abortRecipientSearch,
    clearRecipientSearchTimeout,
    recipientQuery,
    runRecipientSearch
  ])

  const selectRecipient = useCallback((account: MastodonAccount) => {
    latestRecipientSearchRequestIdRef.current += 1
    setResolvingRecipient(false)
    setSelectedRecipients((previousRecipients) => {
      if (previousRecipients.some((item) => item.id === account.id)) {
        return previousRecipients
      }
      return [...previousRecipients, account]
    })
    setRecipientSearchResults([])
    setRecipientQuery('')
  }, [])

  const removeRecipient = useCallback((accountId: string) => {
    setSelectedRecipients((previousRecipients) =>
      previousRecipients.filter((account) => account.id !== accountId)
    )
  }, [])

  const startNewConversation = useCallback(() => {
    setShowConversationListOnMobile(false)
    selectConversation(null)
    setThreadStatuses([])
    setNextMaxStatusId(null)
    setSelectedRecipients([])
    setRecipientSearchResults([])
    setRecipientQuery('')
    latestRecipientSearchRequestIdRef.current += 1
    setResolvingRecipient(false)
    setMessage('')
    setError(null)
  }, [selectConversation])

  const hideSelectedConversation = useCallback(
    async (conversationId: string) => {
      const hidden = await hideConversation({ conversationId })
      if (!hidden) {
        setError('Could not hide conversation')
        return
      }

      setCurrentConversations((previousConversations) => {
        const nextConversations = previousConversations.filter(
          (conversation) => conversation.id !== conversationId
        )
        if (selectedConversationIdRef.current === conversationId) {
          selectConversation(nextConversations[0]?.id ?? null)
        }
        return nextConversations
      })
    },
    [selectConversation]
  )

  const sendMessage = useCallback(
    async (event: FormEvent) => {
      event.preventDefault()
      setError(null)

      if (composerRecipients.length === 0 && !selectedConversation) {
        setError('Choose at least one recipient')
        return
      }

      setSending(true)
      try {
        const sentStatus = await createDirectMessage({
          message,
          recipients: composerRecipients,
          replyStatus: selectedConversation?.lastStatus
        })
        setMessage('')
        setSelectedRecipients([])
        setRecipientSearchResults([])
        setRecipientQuery('')
        latestRecipientSearchRequestIdRef.current += 1
        setResolvingRecipient(false)
        const refreshedConversations = await refreshConversations()
        const matchedConversation = sentStatus.uri
          ? refreshedConversations.find(
              (conversation) => conversation.lastStatus.id === sentStatus.uri
            )
          : undefined
        const nextConversationId =
          selectedConversation?.id ??
          matchedConversation?.id ??
          refreshedConversations[0]?.id ??
          null
        // When the conversation changes, selectConversation triggers the
        // thread-loading effect; only reload explicitly when staying on the
        // same conversation (a reply), where that effect does not re-run.
        const isSameConversation =
          selectedConversation?.id === nextConversationId
        selectConversation(nextConversationId)
        if (nextConversationId && isSameConversation) {
          await loadThread(nextConversationId, { silent: true })
        }
      } catch (_error) {
        setError('Could not send message')
      } finally {
        setSending(false)
      }
    },
    [
      composerRecipients,
      loadThread,
      message,
      refreshConversations,
      selectConversation,
      selectedConversation
    ]
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 md:gap-6">
      <PageHeader
        title="Messages"
        description="Direct conversations with people you follow."
        actions={
          <Button variant="outline" size="sm" onClick={startNewConversation}>
            <Plus className="mr-2 size-4" />
            New
          </Button>
        }
      />

      <section
        aria-label="Direct messages"
        className="grid min-w-0 flex-1 overflow-hidden rounded-xl border bg-background shadow-sm md:min-h-0 md:grid-cols-[minmax(260px,34%)_minmax(0,1fr)] lg:grid-cols-[minmax(320px,30%)_minmax(0,1fr)] 2xl:grid-cols-[380px_minmax(0,1fr)]"
      >
        <aside
          aria-label="Conversation list"
          className={cn(
            'min-w-0 border-b md:min-h-0 md:border-b-0 md:border-r',
            !showConversationListOnMobile && 'max-md:hidden'
          )}
        >
          <div className="md:h-full md:overflow-y-auto">
            {currentConversations.length > 0 ? (
              currentConversations.map((conversation) => {
                const isSelected = conversation.id === selectedConversationId
                const title = conversationTitle(conversation)
                const avatarAccount = conversation.accounts[0]
                const preview = conversationPreviews.get(conversation.id)
                const isOwnLastStatus =
                  conversation.lastStatus.actorId === currentActor.id
                return (
                  <button
                    key={conversation.id}
                    type="button"
                    onClick={() => {
                      selectConversation(conversation.id)
                      setError(null)
                    }}
                    className={cn(
                      'flex w-full items-start gap-3 border-b px-3 py-3 text-left last:border-b-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50 md:px-4 md:py-4',
                      isSelected ? 'bg-muted' : 'hover:bg-muted/60'
                    )}
                  >
                    <Avatar className="mt-0.5 size-9 shrink-0 md:size-11">
                      {avatarAccount?.avatar && (
                        <AvatarImage src={avatarAccount.avatar} />
                      )}
                      <AvatarFallback>{getInitial(title)}</AvatarFallback>
                    </Avatar>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span
                          className={cn(
                            'truncate text-sm md:text-base',
                            conversation.unread
                              ? 'font-semibold'
                              : 'font-medium'
                          )}
                        >
                          {title}
                        </span>
                        {conversation.unread && (
                          <span className="size-2 shrink-0 rounded-full bg-primary" />
                        )}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                        {isOwnLastStatus && preview
                          ? `You: ${preview}`
                          : preview}
                      </span>
                      <span
                        className="block text-xs text-muted-foreground md:mt-1"
                        suppressHydrationWarning
                      >
                        {formatTimestamp(conversation.lastStatusCreatedAt)}
                      </span>
                    </span>
                  </button>
                )
              })
            ) : (
              <div className="p-4 text-sm text-muted-foreground">
                No messages
              </div>
            )}
            {hasMoreConversations && currentConversations.length > 0 && (
              <div className="flex justify-center border-t p-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={loadMoreConversations}
                  disabled={isLoadingMoreConversations}
                >
                  {isLoadingMoreConversations && (
                    <Loader2 className="mr-2 size-4 animate-spin" />
                  )}
                  Load more
                </Button>
              </div>
            )}
          </div>
        </aside>

        <div
          aria-label="Conversation thread"
          className={cn(
            'flex min-h-[60svh] min-w-0 flex-col md:min-h-0',
            showConversationListOnMobile && 'max-md:hidden'
          )}
        >
          <div className="flex min-h-14 items-center justify-between gap-3 border-b px-4 md:min-h-16 md:px-5">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              title="Back to conversations"
              aria-label="Back to conversations"
              className="md:hidden"
              onClick={() => setShowConversationListOnMobile(true)}
            >
              <ArrowLeft className="size-4" />
            </Button>
            {headerAccount && (
              <Avatar className="size-9 shrink-0">
                {headerAccount.avatar && (
                  <AvatarImage src={headerAccount.avatar} alt="" />
                )}
                <AvatarFallback>
                  {getInitial(accountLabel(headerAccount))}
                </AvatarFallback>
              </Avatar>
            )}
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-base font-semibold md:text-lg">
                {headerTitle}
              </h2>
              {composerRecipients.length > 0 && (
                <p className="truncate text-xs text-muted-foreground">
                  {composerRecipients.map(accountHandle).join(', ')}
                </p>
              )}
            </div>
            {selectedConversation && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                title="Hide conversation"
                aria-label="Hide conversation"
                onClick={() =>
                  hideSelectedConversation(selectedConversation.id)
                }
              >
                <Archive className="size-4" />
              </Button>
            )}
          </div>

          <div
            ref={threadContainerRef}
            aria-label="Message thread"
            className="min-h-0 min-w-0 flex-1 overflow-y-auto"
          >
            {isThreadLoading ? (
              <div className="flex h-full items-center justify-center text-muted-foreground">
                <Loader2 className="size-5 animate-spin" />
              </div>
            ) : displayStatuses.length > 0 ? (
              <>
                {nextMaxStatusId && (
                  <div className="flex justify-center border-b p-3">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={loadMoreStatuses}
                      disabled={isLoadingMoreStatuses}
                    >
                      {isLoadingMoreStatuses && (
                        <Loader2 className="mr-2 size-4 animate-spin" />
                      )}
                      Load more
                    </Button>
                  </div>
                )}
                <div className="space-y-3 px-4 py-4 md:px-6">
                  {displayStatuses.map((status) => (
                    <MessageBubble
                      key={status.id}
                      host={host}
                      status={status}
                      isOwn={status.actorId === currentActor.id}
                      onShowAttachment={(medias, index) =>
                        setModalMedias({
                          medias,
                          initialSelection: index
                        })
                      }
                    />
                  ))}
                </div>
              </>
            ) : (
              <div className="flex h-full items-center justify-center p-8 text-sm text-muted-foreground">
                {selectedConversationId
                  ? 'No messages yet'
                  : 'No conversation selected'}
              </div>
            )}
          </div>

          <form
            onSubmit={sendMessage}
            className="space-y-3 border-t p-4 md:p-5"
          >
            {!selectedConversation && (
              <div className="space-y-2">
                {selectedRecipients.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {selectedRecipients.map((account) => (
                      <span
                        key={account.id}
                        className="inline-flex max-w-full items-center gap-2 rounded-md bg-muted px-2 py-1 text-sm"
                      >
                        <span className="truncate">
                          {accountLabel(account)}
                        </span>
                        <button
                          type="button"
                          onClick={() => removeRecipient(account.id)}
                          aria-label={`Remove ${accountLabel(account)}`}
                          className="text-muted-foreground hover:text-foreground"
                        >
                          <X className="size-3.5" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="relative">
                  {isResolvingRecipient ? (
                    <Loader2 className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
                  ) : (
                    <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  )}
                  <Input
                    value={recipientQuery}
                    onChange={(event) => setRecipientQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        void searchForRecipients()
                      }
                    }}
                    name="recipient"
                    aria-label="Search recipients"
                    autoComplete="off"
                    placeholder="@user@example.com"
                    className="pl-9"
                  />
                </div>
                {recipientSearchResults.length > 0 && (
                  <ul
                    aria-label="Recipient search results"
                    className="divide-y rounded-md border bg-background"
                  >
                    {recipientSearchResults.map((account) => (
                      <li key={account.id}>
                        <button
                          type="button"
                          onClick={() => selectRecipient(account)}
                          className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50"
                        >
                          <Avatar className="size-8 shrink-0">
                            {account.avatar && (
                              <AvatarImage src={account.avatar} />
                            )}
                            <AvatarFallback>
                              {getInitial(accountLabel(account))}
                            </AvatarFallback>
                          </Avatar>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">
                              {accountLabel(account)}
                            </span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {accountHandle(account)}
                            </span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <div className="flex items-end gap-2">
              <Textarea
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                onKeyDown={handleMessageKeyDown}
                name="message"
                aria-label="Message text"
                autoComplete="off"
                placeholder="Write a message"
                className="max-h-40 min-h-10 flex-1 resize-none"
              />
              <Button
                type="submit"
                disabled={isSending || !message.trim()}
                aria-label="Send message"
                title="Send message"
                className="shrink-0"
              >
                {isSending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Send className="size-4" />
                )}
                <span>Send</span>
              </Button>
            </div>
            {error && (
              <p
                className="text-sm text-destructive"
                role="alert"
                aria-live="assertive"
              >
                {error}
              </p>
            )}
          </form>
        </div>
      </section>

      <MediasModal
        medias={modalMedias?.medias ?? null}
        initialSelection={modalMedias?.initialSelection ?? 0}
        onClosed={() => setModalMedias(null)}
      />
    </div>
  )
}
