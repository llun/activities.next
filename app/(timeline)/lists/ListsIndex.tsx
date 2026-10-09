'use client'

import {
  ChevronRight,
  Layers,
  List as ListIcon,
  ListPlus,
  Plus
} from 'lucide-react'
import Link from 'next/link'
import { FC } from 'react'

import { PageHeader } from '@/lib/components/page-header'
import { EmptyState } from '@/lib/components/surface/EmptyState'
import { FramedList, FramedListItem } from '@/lib/components/surface/FramedList'
import { Section } from '@/lib/components/surface/Section'
import { Avatar, AvatarFallback, AvatarImage } from '@/lib/components/ui/avatar'
import { Button } from '@/lib/components/ui/button'
import { CollectionEntity } from '@/lib/types/mastodon/collection'
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

export interface CollectionSummary extends CollectionEntity {
  // Total members (every featureState); `size` from the entity is the approved
  // (publicly featured) subset.
  memberCount: number
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

const collectionMemberSummary = (collection: CollectionSummary) => {
  const total = collection.memberCount
  if (total === 0) return 'No one yet'
  const people = `${total} ${total === 1 ? 'person' : 'people'}`
  return `${people} · ${collection.size} featured publicly`
}

const NewListButton = ({ variant }: { variant?: 'outline' }) => (
  <Button asChild variant={variant}>
    <Link href="/lists/new">
      <ListPlus className="size-4" />
      New list
    </Link>
  </Button>
)

const NewCollectionButton = () => (
  <Button asChild>
    <Link href="/collections/new">
      <Plus className="size-4" />
      New collection
    </Link>
  </Button>
)

interface ListsIndexProps {
  lists: ListSummary[]
  collections: CollectionSummary[]
}

export const ListsIndex: FC<ListsIndexProps> = ({ lists, collections }) => {
  const isEmpty = lists.length === 0 && collections.length === 0

  return (
    <div className="space-y-6">
      <PageHeader
        title="Lists & collections"
        description="Private curated timelines and shareable feeds you highlight"
        stackActionsOnMobile
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <NewListButton variant="outline" />
            <NewCollectionButton />
          </div>
        }
      />

      {isEmpty ? (
        <EmptyState
          icon={Layers}
          titleAs="h2"
          title="Nothing here yet"
          action={
            <div className="flex flex-wrap items-center gap-2">
              <NewCollectionButton />
              <NewListButton variant="outline" />
            </div>
          }
        >
          Make a private list to follow a focused timeline, or a collection to
          share a feed of people you highlight.
        </EmptyState>
      ) : (
        <>
          {collections.length > 0 && (
            <Section
              icon={Layers}
              title="Collections"
              description="Shareable feeds you curate"
            >
              <FramedList aria-label="Collections">
                {collections.map((collection) => (
                  <FramedListItem
                    key={collection.id}
                    href={`/collections/${collection.id}`}
                  >
                    <span className="flex items-center gap-4">
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                        <Layers className="size-5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">
                          {collection.title}
                        </span>
                        <span className="block truncate text-sm text-muted-foreground">
                          {collectionMemberSummary(collection)}
                        </span>
                      </span>
                      <ChevronRight className="size-5 shrink-0 text-muted-foreground" />
                    </span>
                  </FramedListItem>
                ))}
              </FramedList>
            </Section>
          )}

          {lists.length > 0 && (
            <Section
              icon={ListIcon}
              title="Lists"
              description="Private timelines"
            >
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
                              {member.avatar && (
                                <AvatarImage src={member.avatar} />
                              )}
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
        </>
      )}
    </div>
  )
}
