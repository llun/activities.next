import * as React from 'react'

import { cn } from '@/lib/utils'

function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      className={cn(
        'relative overflow-hidden rounded-md bg-muted',
        'after:absolute after:inset-0 after:-translate-x-full',
        'after:animate-shimmer',
        'after:bg-gradient-to-r after:from-transparent after:via-white/60 dark:after:via-white/10 after:to-transparent',
        className
      )}
      {...props}
    />
  )
}

function PageHeaderSkeleton({
  hasDescription = true,
  hasAction = false,
  className
}: {
  hasDescription?: boolean
  hasAction?: boolean
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between',
        className
      )}
      aria-hidden="true"
    >
      <div className="space-y-1.5">
        <Skeleton className="h-8 w-44" />
        {hasDescription && <Skeleton className="h-4 w-72" />}
      </div>
      {hasAction && <Skeleton className="h-9 w-28 rounded-md" />}
    </div>
  )
}

function PostSkeleton({
  framed = true,
  hasMedia = false,
  className
}: {
  framed?: boolean
  hasMedia?: boolean
  className?: string
}) {
  return (
    <div
      className={cn(
        framed
          ? 'overflow-hidden rounded-2xl border bg-background/80 p-4 shadow-sm'
          : 'border-b border-border/60 p-4 last:border-b-0',
        'space-y-3',
        className
      )}
      aria-hidden="true"
    >
      {/* Author row */}
      <div className="flex items-center gap-3">
        <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
        <div className="flex-1 space-y-1.5">
          <div className="flex items-center gap-2">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-3.5 w-20" />
          </div>
          <Skeleton className="h-3 w-16" />
        </div>
      </div>

      {/* Post body */}
      <div className="space-y-2 pt-1">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-3/4" />
      </div>

      {/* Optional media placeholder */}
      {hasMedia && <Skeleton className="h-48 w-full rounded-xl" />}

      {/* Action buttons */}
      <div className="flex items-center justify-between pt-2">
        <div className="flex items-center gap-6">
          <Skeleton className="h-5 w-8 rounded" />
          <Skeleton className="h-5 w-8 rounded" />
          <Skeleton className="h-5 w-8 rounded" />
          <Skeleton className="h-5 w-8 rounded" />
        </div>
        <Skeleton className="h-5 w-5 rounded" />
      </div>
    </div>
  )
}

function ComposerSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-2xl border bg-background/80 p-4 shadow-sm space-y-3',
        className
      )}
      aria-hidden="true"
    >
      <div className="flex gap-3">
        <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
        <Skeleton className="h-20 flex-1 rounded-xl" />
      </div>
      <div className="flex items-center justify-between pt-1">
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-8 rounded-md" />
          <Skeleton className="h-8 w-8 rounded-md" />
          <Skeleton className="h-8 w-8 rounded-md" />
          <Skeleton className="h-8 w-8 rounded-md" />
        </div>
        <Skeleton className="h-9 w-20 rounded-md" />
      </div>
    </div>
  )
}

function UserRowSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'flex items-start justify-between gap-3 p-4 border-b border-border/60 last:border-b-0',
        className
      )}
      aria-hidden="true"
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <Skeleton className="h-11 w-11 shrink-0 rounded-full" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3.5 w-24" />
          </div>
          <Skeleton className="h-3.5 w-3/4 max-w-sm" />
        </div>
      </div>
      <Skeleton className="h-8 w-20 shrink-0 rounded-md" />
    </div>
  )
}

function ProfileHeaderSkeleton({ className }: { className?: string }) {
  return (
    <section
      className={cn(
        'overflow-hidden rounded-2xl border bg-background/80 shadow-sm',
        className
      )}
      aria-hidden="true"
    >
      {/* Banner */}
      <Skeleton className="h-40 w-full rounded-none sm:h-48" />

      <div className="relative px-6 pb-6">
        {/* Avatar */}
        <Skeleton className="relative -mt-10 h-20 w-20 rounded-full border-4 border-background" />

        {/* Name and actions */}
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1.5">
            <Skeleton className="h-7 w-44" />
            <Skeleton className="h-4 w-28" />
          </div>
          <Skeleton className="h-9 w-28 rounded-md" />
        </div>

        {/* Bio */}
        <div className="mt-4 space-y-2">
          <Skeleton className="h-4 w-full max-w-lg" />
          <Skeleton className="h-4 w-4/5 max-w-md" />
        </div>

        {/* Counts row */}
        <div className="mt-5 flex flex-wrap gap-6">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-24" />
        </div>

        {/* Featured tags */}
        <div className="mt-4 flex flex-wrap gap-2">
          <Skeleton className="h-6 w-20 rounded-full" />
          <Skeleton className="h-6 w-16 rounded-full" />
          <Skeleton className="h-6 w-24 rounded-full" />
        </div>
      </div>
    </section>
  )
}

function NotificationRowSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'flex items-start gap-3 p-4 border-b border-border/60 last:border-b-0',
        className
      )}
      aria-hidden="true"
    >
      <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
      <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
      <div className="flex-1 space-y-1.5">
        <div className="flex items-center gap-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-12" />
        </div>
        <Skeleton className="h-3.5 w-4/5 max-w-md" />
      </div>
    </div>
  )
}

export {
  Skeleton,
  PageHeaderSkeleton,
  PostSkeleton,
  ComposerSkeleton,
  UserRowSkeleton,
  ProfileHeaderSkeleton,
  NotificationRowSkeleton
}
