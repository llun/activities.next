'use client'

import { FC, useCallback, useEffect, useRef, useState } from 'react'

import { Button } from '@/lib/components/ui/button'

interface ScrollToTopButtonProps {
  isLoadMoreVisible?: boolean
}

export const ScrollToTopButton: FC<ScrollToTopButtonProps> = ({
  isLoadMoreVisible = false
}) => {
  const [isVisible, setIsVisible] = useState(false)
  const timeoutRef = useRef<number | null>(null)

  const toggleVisibility = useCallback(() => {
    // Show button when page is scrolled down more than 300px
    if (window.scrollY > 300) {
      setIsVisible(true)
    } else {
      setIsVisible(false)
    }
  }, [])

  useEffect(() => {
    // Set initial visibility based on current scroll position
    toggleVisibility()

    const handleScroll = () => {
      // Throttle scroll events to improve performance
      if (timeoutRef.current) {
        return
      }

      timeoutRef.current = window.setTimeout(() => {
        toggleVisibility()
        timeoutRef.current = null
      }, 100)
    }

    window.addEventListener('scroll', handleScroll, { passive: true })

    return () => {
      window.removeEventListener('scroll', handleScroll)
      if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current)
      }
    }
  }, [toggleVisibility])

  const scrollToTop = () => {
    window.scrollTo({
      top: 0,
      behavior: 'smooth'
    })
  }

  // Hide the button if load more is visible or if not scrolled enough
  if (!isVisible || isLoadMoreVisible) {
    return null
  }

  return (
    <Button
      type="button"
      variant="pill"
      onClick={scrollToTop}
      className="fixed inset-x-0 mx-auto w-fit h-auto bottom-[calc(env(safe-area-inset-bottom,0px)+0.75rem)] z-30 bg-popover text-popover-foreground shadow-lg dark:bg-popover dark:hover:bg-accent md:hidden animate-in fade-in-0 slide-in-from-bottom-2 duration-200"
      aria-label="Scroll to top"
    >
      Scroll to top
    </Button>
  )
}
