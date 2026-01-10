'use client'

import { formatDistance, formatRelative } from 'date-fns'
import { FC } from 'react'

import { Session } from '@/lib/models/session'

import { DeleteSessionButton } from '../../../app/(timeline)/settings/sessions/DeleteSessionButton'

interface SessionsListProps {
  sessions: Session[]
  currentTime: number
  currentSessionToken: string | null
}

export const SessionsList: FC<SessionsListProps> = ({
  sessions,
  currentTime,
  currentSessionToken
}) => {
  // Sort sessions by creation time (newest first)
  const sortedSessions = [...sessions].sort((a, b) => b.createdAt - a.createdAt)

  return (
    <section className="space-y-4 rounded-2xl border bg-background/80 p-6 shadow-sm">
      {sortedSessions.length > 0 ? (
        <ol className="space-y-3">
          {sortedSessions.map((existingSession) => {
            const isCurrentSession =
              currentSessionToken === existingSession.token

            return (
              <li
                key={`session-${existingSession.token}`}
                className={`rounded-xl border p-4 shadow-sm ${
                  isCurrentSession
                    ? 'bg-primary/5 border-primary/20'
                    : 'bg-background'
                }`}
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-foreground">
                        Signed in{' '}
                        {formatRelative(existingSession.createdAt, currentTime)}
                      </p>
                      {isCurrentSession && (
                        <span className="inline-flex items-center rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">
                          Current Session
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Expires in{' '}
                      {formatDistance(existingSession.expireAt, currentTime)}
                    </p>
                  </div>
                  <DeleteSessionButton existingSession={existingSession} />
                </div>
              </li>
            )
          })}
        </ol>
      ) : (
        <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          No active sessions found.
        </div>
      )}
    </section>
  )
}
