'use client'

import { Archive, Loader2, Mail, Plus, Search, Send, X } from 'lucide-react'
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
import { Posts } from '@/lib/components/posts/posts'
import { Avatar, AvatarFallback, AvatarImage } from '@/lib/components/ui/avatar'
import { Button } from '@/lib/components/ui/button'
import { Input } from '@/lib/components/ui/input'
import { Textarea } from '@/lib/components/ui/textarea'
import { PostLineLimit } from '@/lib/types/database/rows'
import { ActorProfile } from '@/lib/types/domain/actor'
import { Status } from '@/lib/types/domain/status'
import type { Account as MastodonAccount } from '@/lib/types/mastodon/account'
import { cn } from '@/lib/utils'

interface MessagesPageProps {
  host: string
  conversations: DirectConversationView[]
  initialConversationId: string | null
  initialStatuses: Status[]
  initialNextMaxStatusId: string | null
  currentTime: number
  currentActor: ActorProfile
  postLineLimit?: PostLineLimit
}

const READ_RETRY_COOLDOWN_MS = 30_000

const accountLabel = (account: MastodonAccount) =>
  account.display_name || account.acct || account.username

const accountHandle = (account: MastodonAccount) =>
  account.acct.startsWith('@') ? account.acct : `@${account.acct}`

const getInitial = (value: string) =>
  value.trim().length > 0 ? value.trim()[0].toUpperCase() : '?'

const conversationTitle = (conversation: DirectConversationView) => {
  if (conversation.accounts.length === 0) return 'You'
  return conversation.accounts.map(accountLabel).join(', ')
}

const conversationSubtitle = (conversation: DirectConversationView) => {
  if (
    conversation.lastStatus.type === 'Note' ||
    conversation.lastStatus.type === 'Poll'
  ) {
    return conversation.lastStatus.text || 'Message'
  }
  return 'Message'
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
  currentTime,
  currentActor,
  postLineLimit
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
  const [error, setError] = useState<string | null>(null)
  const latestThreadRequestIdRef = useRef(0)
  const selectedConversationIdRef = useRef(selectedConversationId)
  const threadContainerRef = useRef<HTMLDivElement | null>(null)
  const lastFailedReadAtRef = useRef(new Map<string, number>())
  const pendingReadConversationIdsRef = useRef(new Set<string>())
  const latestReadRequestIdRef = useRef(new Map<string, number>())
  const lastAutoScrolledStatusIdRef = useRef<string | null>(null)
  const pendingOlderScrollAnchorRef = useRef<{
    requestId: number
    scrollHeight: number
    scrollTop: number
  } | null>(null)

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
  const newestDisplayedStatusId =
    displayStatuses[displayStatuses.length - 1]?.id ?? null
  const composerRecipients = selectedConversation
    ? selectedConversation.accounts
    : selectedRecipients

  const [readRetryNonce, setReadRetryNonce] = useState(0)

  const selectConversation = useCallback((conversationId: string | null) => {
    if (conversationId) {
      const hadFailed = lastFailedReadAtRef.current.delete(conversationId)
      if (hadFailed) setReadRetryNonce((nonce) => nonce + 1)
    }
    if (conversationId === selectedConversationIdRef.current) return
    latestThreadRequestIdRef.current += 1
    selectedConversationIdRef.current = conversationId
    lastAutoScrolledStatusIdRef.current = null
    pendingOlderScrollAnchorRef.current = null
    setSelectedConversationId(conversationId)
  }, [])

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
    const result = await getConversations()
    setCurrentConversations(result.conversations)
    return result.conversations
  }, [])

  const searchForRecipients = useCallback(async () => {
    const query = recipientQuery.trim()
    if (!query) return

    setResolvingRecipient(true)
    setError(null)
    try {
      const results = await searchAccounts({
        q: query,
        resolve: true,
        limit: 5
      })
      setRecipientSearchResults(results)
      if (results.length === 0) {
        setError('Account not found')
      }
    } catch (_error) {
      setError('Could not search for account')
    } finally {
      setResolvingRecipient(false)
    }
  }, [recipientQuery])

  const selectRecipient = useCallback((account: MastodonAccount) => {
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
    selectConversation(null)
    setThreadStatuses([])
    setNextMaxStatusId(null)
    setSelectedRecipients([])
    setRecipientSearchResults([])
    setRecipientQuery('')
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
        await createDirectMessage({
          message,
          recipients: composerRecipients,
          replyStatus: selectedConversation?.lastStatus
        })
        setMessage('')
        setSelectedRecipients([])
        setRecipientSearchResults([])
        setRecipientQuery('')
        const refreshedConversations = await refreshConversations()
        const nextConversationId =
          selectedConversation?.id ?? refreshedConversations[0]?.id ?? null
        selectConversation(nextConversationId)
        if (nextConversationId) {
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
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Mail className="size-6 text-muted-foreground" />
          <h1 className="text-2xl font-semibold">Messages</h1>
        </div>
        <Button variant="outline" size="sm" onClick={startNewConversation}>
          <Plus className="mr-2 size-4" />
          New
        </Button>
      </div>

      <section className="grid overflow-hidden rounded-lg border bg-background md:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="border-b md:border-b-0 md:border-r">
          <div className="max-h-[420px] overflow-y-auto">
            {currentConversations.length > 0 ? (
              currentConversations.map((conversation) => {
                const isSelected = conversation.id === selectedConversationId
                const title = conversationTitle(conversation)
                const avatarAccount = conversation.accounts[0]
                return (
                  <button
                    key={conversation.id}
                    type="button"
                    onClick={() => {
                      selectConversation(conversation.id)
                      setError(null)
                    }}
                    className={cn(
                      'flex w-full items-start gap-3 border-b px-3 py-3 text-left last:border-b-0',
                      isSelected ? 'bg-muted' : 'hover:bg-muted/60'
                    )}
                  >
                    <Avatar className="mt-0.5 size-9 shrink-0">
                      {avatarAccount?.avatar && (
                        <AvatarImage src={avatarAccount.avatar} />
                      )}
                      <AvatarFallback>{getInitial(title)}</AvatarFallback>
                    </Avatar>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span
                          className={cn(
                            'truncate text-sm',
                            conversation.unread && 'font-semibold'
                          )}
                        >
                          {title}
                        </span>
                        {conversation.unread && (
                          <span className="size-2 rounded-full bg-primary" />
                        )}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {conversationSubtitle(conversation)}
                      </span>
                      <span className="block text-xs text-muted-foreground">
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
          </div>
        </aside>

        <div className="flex min-h-[520px] flex-col">
          <div className="flex min-h-14 items-center justify-between gap-3 border-b px-4">
            <div className="min-w-0">
              <h2 className="truncate text-base font-semibold">
                {selectedConversation
                  ? conversationTitle(selectedConversation)
                  : 'New message'}
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
            className="min-h-0 flex-1 overflow-y-auto"
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
                <Posts
                  host={host}
                  currentTime={currentTime}
                  statuses={displayStatuses}
                  currentActor={currentActor}
                  postLineLimit={postLineLimit}
                />
              </>
            ) : (
              <div className="flex h-full items-center justify-center p-8 text-sm text-muted-foreground">
                No conversation selected
              </div>
            )}
          </div>

          <form onSubmit={sendMessage} className="space-y-3 border-t p-4">
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
                <div className="flex gap-2">
                  <Input
                    value={recipientQuery}
                    onChange={(event) => setRecipientQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        void searchForRecipients()
                      }
                    }}
                    placeholder="@user@example.com"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={searchForRecipients}
                    disabled={isResolvingRecipient}
                  >
                    {isResolvingRecipient ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Search className="size-4" />
                    )}
                  </Button>
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
                          className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted"
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
                placeholder="Write a message"
                className="min-h-24 resize-y"
              />
              <Button type="submit" disabled={isSending || !message.trim()}>
                {isSending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Send className="size-4" />
                )}
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
    </div>
  )
}
