'use client'

import { ChevronRight, List as ListIcon, ListPlus } from 'lucide-react'
import Link from 'next/link'
import { FC } from 'react'

import { PageHeader } from '@/lib/components/page-header'
import { Avatar, AvatarFallback, AvatarImage } from '@/lib/components/ui/avatar'
import { Button } from '@/lib/components/ui/button'
import { ListEntity } from '@/lib/types/mastodon/list'

export interface ListPreviewMember {
  id: string
  name: string
  avatar?: string
}

export interface ListSummary extends ListEntity {
  memberCount: number
  previewMembers: ListPreviewMember[]
}

const getInitials = (name: string) =>
  name
    .split(' ')
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase() || '?'

const memberSummary = (list: ListSummary) => {
  if (list.memberCount === 0) return 'No members yet'
  const members = `${list.memberCount} member${list.memberCount === 1 ? '' : 's'}`
  return list.exclusive ? `${members} · Hidden from Home` : members
}

const NewListButton = () => (
  <Button asChild>
    <Link href="/lists/new">
      <ListPlus className="h-4 w-4" />
      New list
    </Link>
  </Button>
)

interface ListsIndexProps {
  lists: ListSummary[]
}

export const ListsIndex: FC<ListsIndexProps> = ({ lists }) => (
  <div className="space-y-6">
    <PageHeader
      title="Lists"
      description="Curated timelines from accounts you follow"
      actions={<NewListButton />}
    />

    {lists.length > 0 ? (
      <div className="divide-y overflow-hidden rounded-xl border bg-card shadow-sm">
        {lists.map((list) => (
          <Link
            key={list.id}
            href={`/lists/${list.id}`}
            className="flex items-center gap-4 px-4 py-4 transition-colors hover:bg-muted/60"
          >
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <ListIcon className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{list.title}</p>
              <p className="truncate text-sm text-muted-foreground">
                {memberSummary(list)}
              </p>
            </div>
            {list.previewMembers.length > 0 && (
              <div className="flex -space-x-2">
                {list.previewMembers.map((member) => (
                  <Avatar key={member.id} className="h-7 w-7 ring-2 ring-card">
                    {member.avatar && <AvatarImage src={member.avatar} />}
                    <AvatarFallback className="text-xs">
                      {getInitials(member.name)}
                    </AvatarFallback>
                  </Avatar>
                ))}
              </div>
            )}
            <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
          </Link>
        ))}
      </div>
    ) : (
      <div className="rounded-xl border bg-card p-8 text-center text-muted-foreground shadow-sm">
        <h2 className="mb-2 text-xl font-semibold">No lists yet</h2>
        <p className="mb-6">
          Group accounts you follow into curated timelines you can read
          separately from Home.
        </p>
        <NewListButton />
      </div>
    )}
  </div>
)
