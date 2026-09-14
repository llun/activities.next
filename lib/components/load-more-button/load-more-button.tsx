'use client'

import { ComponentProps, FC, ReactNode, Ref } from 'react'

import { Button } from '@/lib/components/ui/button'
import { cn } from '@/lib/utils'

export const LOAD_MORE_CONTAINER_CLASS =
  'text-center py-4 max-md:pt-6 max-md:pb-[calc(env(safe-area-inset-bottom,0px)+1.5rem)]'

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
  ...props
}) => {
  const button = (
    <Button
      type={type}
      variant={variant}
      disabled={disabled || isLoading}
      aria-busy={isLoading || undefined}
      {...props}
    >
      {isLoading ? loadingText : children}
    </Button>
  )

  if (
    containerRef !== undefined ||
    containerClassName !== undefined ||
    error !== undefined
  ) {
    return (
      <div
        ref={containerRef}
        className={cn(LOAD_MORE_CONTAINER_CLASS, containerClassName)}
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
