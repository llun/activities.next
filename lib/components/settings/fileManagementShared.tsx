'use client'

import { FC } from 'react'

import { Button } from '@/lib/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/lib/components/ui/dropdown-menu'
import { getMentionFromActorID } from '@/lib/types/domain/actor'

/**
 * Builds the in-app permalink for the status a stored file is attached to, or
 * `null` when the actor mention cannot be resolved. Shared by the media and
 * fitness-file management screens.
 */
export const getFileStatusLink = (actorId: string, statusId: string) => {
  try {
    const actorMention = getMentionFromActorID(actorId, true)
    const encodedStatusId = encodeURIComponent(statusId)
    return `/${actorMention}/${encodedStatusId}`
  } catch {
    return null
  }
}

const PER_PAGE_OPTIONS = [25, 50, 100]

interface ItemsPerPageDropdownProps {
  itemsPerPage: number
  onChange: (value: number) => void
}

/** "N per page" dropdown shared by the file-management screens. */
export const ItemsPerPageDropdown: FC<ItemsPerPageDropdownProps> = ({
  itemsPerPage,
  onChange
}) => (
  <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button variant="outline" size="sm">
        {itemsPerPage} per page
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      {PER_PAGE_OPTIONS.map((option) => (
        <DropdownMenuItem key={option} onClick={() => onChange(option)}>
          {option} per page
        </DropdownMenuItem>
      ))}
    </DropdownMenuContent>
  </DropdownMenu>
)

interface FileListPaginationProps {
  currentPage: number
  itemsPerPage: number
  totalItems: number
  onPageChange: (page: number) => void
}

/**
 * "Page X of Y • Showing a-b of n" footer with Previous/Next controls, shared by
 * the file-management screens. Renders nothing when there are no items.
 */
export const FileListPagination: FC<FileListPaginationProps> = ({
  currentPage,
  itemsPerPage,
  totalItems,
  onPageChange
}) => {
  if (totalItems <= 0) return null

  const totalPages = Math.ceil(totalItems / itemsPerPage)
  const hasNextPage = currentPage < totalPages
  const hasPreviousPage = currentPage > 1
  const startItem = (currentPage - 1) * itemsPerPage + 1
  const endItem = Math.min(currentPage * itemsPerPage, totalItems)

  return (
    <div className="mt-4 flex items-center justify-between border-t pt-4">
      <div className="text-sm text-muted-foreground">
        Page {currentPage} of {totalPages} • Showing {startItem}-{endItem} of{' '}
        {totalItems} items
      </div>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(currentPage - 1)}
          disabled={!hasPreviousPage}
        >
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(currentPage + 1)}
          disabled={!hasNextPage}
        >
          Next
        </Button>
      </div>
    </div>
  )
}
