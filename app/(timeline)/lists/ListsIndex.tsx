'use client'

import { ChevronRight, List as ListIcon, ListPlus } from 'lucide-react'
import Link from 'next/link'
import { FC } from 'react'

import { PageHeader } from '@/lib/components/page-header'
import { EmptyState } from '@/lib/components/surface/EmptyState'
import { FramedList, FramedListItem } from '@/lib/components/surface/FramedList'
import { Section } from '@/lib/components/surface/Section'
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

const listMemberSummary = (list: ListSummary) => {
  if (list.memberCount === 0) return 'No members yet'
  const members = `${list.memberCount} member${list.memberCount === 1 ? '' : 's'}`
  return list.exclusive ? `${members} · Hidden from Home` : members
}

const NewListButton = () => (
  <Button asChild>
    <Link href="/lists/new">
      <ListPlus className="size-4" />
      New list
    </Link>
  </Button>
)

interface ListsIndexProps {
  lists: ListSummary[]
}

export const ListsIndex: FC<ListsIndexProps> = ({ lists }) => {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Lists"
        description="Private curated timelines"
        stackActionsOnMobile
        actions={<NewListButton />}
      />

      {lists.length === 0 ? (
        <EmptyState
          icon={ListIcon}
          titleAs="h2"
          title="Nothing here yet"
          action={<NewListButton />}
        >
          Make a private list to follow a focused timeline.
        </EmptyState>
      ) : (
        <Section icon={ListIcon} title="Lists" description="Private timelines">
          <FramedList aria-label="Lists">
            {lists.map((list) => (
              <FramedListItem key={list.id} href={`/lists/${list.id}`}>
                <span className="flex items-center gap-4">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                    <ListIcon className="size-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">
                      {list.title}
                    </span>
                    <span className="block truncate text-sm text-muted-foreground">
                      {listMemberSummary(list)}
                    </span>
                  </span>
                  {list.previewMembers.length > 0 && (
                    <span className="hidden -space-x-2 sm:flex">
                      {list.previewMembers.map((member) => (
                        <Avatar
                          key={member.id}
                          className="size-7 ring-2 ring-background"
                        >
                          {member.avatar && <AvatarImage src={member.avatar} />}
                          <AvatarFallback className="text-xs">
                            {getInitials(member.name)}
                          </AvatarFallback>
                        </Avatar>
                      ))}
                    </span>
                  )}
                  <ChevronRight className="size-5 shrink-0 text-muted-foreground" />
                </span>
              </FramedListItem>
            ))}
          </FramedList>
        </Section>
      )}
    </div>
  )
}
