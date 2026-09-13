'use client'

import { ComponentProps, FC, ReactNode, Ref } from 'react'

import { Button } from '@/lib/components/ui/button'

export interface LoadMoreButtonProps extends Omit<
  ComponentProps<typeof Button>,
  'children'
> {
  isLoading?: boolean
  loadingText?: ReactNode
  children?: ReactNode
  containerRef?: Ref<HTMLDivElement>
  containerClassName?: string
}

export const LoadMoreButton: FC<LoadMoreButtonProps> = ({
  isLoading = false,
  loadingText = 'Loading...',
  children = 'Load more',
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
      disabled={disabled ?? isLoading}
      {...props}
    >
      {isLoading ? loadingText : children}
    </Button>
  )

  if (containerRef !== undefined || containerClassName !== undefined) {
    return (
      <div ref={containerRef} className={containerClassName ?? 'text-center'}>
        {button}
      </div>
    )
  }

  return button
}
