'use client'

import { ComponentProps, FC, ReactNode, Ref } from 'react'

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
  loadingText = 'Loading...',
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
        {error && (
          <p className="mb-3 text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        {button}
      </div>
    )
  }

  return button
}
