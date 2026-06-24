'use client'

import {
  ChevronRight,
  Layers,
  List as ListIcon,
  ListPlus,
  Plus
} from 'lucide-react'
import Link from 'next/link'
import { FC, ReactNode } from 'react'

import { PageHeader } from '@/lib/components/page-header'
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
      <ListPlus className="h-4 w-4" />
      New list
    </Link>
  </Button>
)

const NewCollectionButton = () => (
  <Button asChild>
    <Link href="/collections/new">
      <Plus className="h-4 w-4" />
      New collection
    </Link>
  </Button>
)

interface IndexGroupProps {
  icon: typeof ListIcon
  title: string
  hint: string
  children: ReactNode
}

const IndexGroup: FC<IndexGroupProps> = ({
  icon: Icon,
  title,
  hint,
  children
}) => (
  <section className="space-y-2">
    <div className="flex items-baseline gap-2 px-1">
      <span className="inline-flex items-center gap-1.5 text-sm font-semibold">
        <Icon className="h-4 w-4 text-primary" />
        {title}
      </span>
      <span className="text-xs text-muted-foreground">{hint}</span>
    </div>
    <div className="divide-y overflow-hidden rounded-xl border bg-card shadow-sm">
      {children}
    </div>
  </section>
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
        title="Lists & Collections"
        description="Private curated timelines and shareable feeds you highlight"
        actions={
          <div className="flex items-center gap-2">
            <NewListButton variant="outline" />
            <NewCollectionButton />
          </div>
        }
      />

      {isEmpty ? (
        <div className="rounded-xl border bg-card p-8 text-center text-muted-foreground shadow-sm">
          <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Layers className="h-6 w-6" />
          </span>
          <h2 className="mb-2 text-xl font-semibold text-foreground">
            Nothing here yet
          </h2>
          <p className="mb-6">
            Make a private list to follow a focused timeline — or a collection
            to share a feed of people you highlight.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <NewCollectionButton />
            <NewListButton variant="outline" />
          </div>
        </div>
      ) : (
        <>
          {collections.length > 0 && (
            <IndexGroup
              icon={Layers}
              title="Collections"
              hint="shareable feeds you curate"
            >
              {collections.map((collection) => (
                <Link
                  key={collection.id}
                  href={`/collections/${collection.id}`}
                  className="flex items-center gap-4 px-4 py-4 transition-colors hover:bg-muted/60"
                >
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Layers className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{collection.title}</p>
                    <p className="truncate text-sm text-muted-foreground">
                      {collectionMemberSummary(collection)}
                    </p>
                  </div>
                  <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
                </Link>
              ))}
            </IndexGroup>
          )}

          {lists.length > 0 && (
            <IndexGroup icon={ListIcon} title="Lists" hint="private timelines">
              {lists.map((list) => (
                <Link
                  key={list.id}
                  href={`/lists/${list.id}`}
                  className="flex items-center gap-4 px-4 py-4 transition-colors hover:bg-muted/60"
                >
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                    <ListIcon className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{list.title}</p>
                    <p className="truncate text-sm text-muted-foreground">
                      {listMemberSummary(list)}
                    </p>
                  </div>
                  {list.previewMembers.length > 0 && (
                    <div className="hidden -space-x-2 sm:flex">
                      {list.previewMembers.map((member) => (
                        <Avatar
                          key={member.id}
                          className="h-7 w-7 ring-2 ring-card"
                        >
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
            </IndexGroup>
          )}
        </>
      )}
    </div>
  )
}
