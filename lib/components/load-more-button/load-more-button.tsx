'use client'

import { ComponentProps, FC, ReactNode, Ref } from 'react'

import { Alert } from '@/lib/components/surface/Alert'
import { Button } from '@/lib/components/ui/button'
import { cn } from '@/lib/utils'

export const LOAD_MORE_CONTAINER_CLASS =
  'text-center py-4 max-md:pt-6 max-md:pb-[calc(env(safe-area-inset-bottom,0px)+1.5rem)]'

export const LOAD_MORE_OVERLAY_CONTAINER_CLASS =
  'md:py-4 md:text-center md:mt-0 md:h-auto max-md:relative max-md:z-10 max-md:-mt-6 max-md:h-0 max-md:flex max-md:justify-center max-md:pointer-events-none'

export type LoadMorePresentation = 'in-flow' | 'overlay'

export interface LoadMoreButtonProps extends Omit<
  ComponentProps<typeof Button>,
  'children'
> {
  isLoading?: boolean
  loadingText?: ReactNode
  children?: ReactNode
  error?: ReactNode
  containerRef?: Ref<HTMLDivElement>
  containerClassName?: string
  presentation?: LoadMorePresentation
  hasItems?: boolean
}

export const LoadMoreButton: FC<LoadMoreButtonProps> = ({
  isLoading = false,
  loadingText = 'Loading more',
  children = 'Load more',
  error,
  disabled,
  variant = 'pill',
  type = 'button',
  containerRef,
  containerClassName,
  presentation = 'in-flow',
  hasItems = true,
  className,
  ...props
}) => {
  const isOverlay = presentation === 'overlay'
  const isOverlayWithItems = isOverlay && hasItems && !error

  const button = (
    <Button
      type={type}
      variant={variant}
      disabled={disabled || isLoading}
      aria-busy={isLoading || undefined}
      className={cn(
        // The design's 36px pill is 110px wide. "Load more" alone is about
        // 106px with the default size's padding, so the floor makes up the
        // rest — and keeps the pill from changing width when it swaps to
        // "Loading more". A longer caller-provided label is wider than the floor
        // and unaffected, and so is a `size="sm"` pill, which the design does
        // not draw.
        (props.size ?? 'default') === 'default' && 'min-w-[110px]',
        isOverlayWithItems &&
          'max-md:pointer-events-auto max-md:-translate-y-12',
        className
      )}
      {...props}
    >
      {isLoading ? loadingText : children}
    </Button>
  )

  if (
    isOverlay ||
    containerRef !== undefined ||
    containerClassName !== undefined ||
    error !== undefined
  ) {
    const defaultContainerClass = isOverlay
      ? isOverlayWithItems
        ? LOAD_MORE_OVERLAY_CONTAINER_CLASS
        : 'py-4 text-center'
      : LOAD_MORE_CONTAINER_CLASS

    return (
      <div
        ref={containerRef}
        className={cn(defaultContainerClass, containerClassName)}
      >
        {error && <Alert title={error} className="mb-3" />}
        {button}
      </div>
    )
  }

  return button
}
