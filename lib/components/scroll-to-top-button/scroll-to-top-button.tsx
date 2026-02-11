'use client'

import { FC, useCallback, useEffect, useRef, useState } from 'react'

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
    <button
      onClick={scrollToTop}
      className="fixed inset-x-0 mx-auto w-fit bottom-[calc(env(safe-area-inset-bottom,0px)+4.5rem)] z-50 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-900 shadow-lg md:hidden animate-in fade-in-0 slide-in-from-bottom-2 duration-200"
      aria-label="Scroll to top"
    >
      Scroll to top
    </button>
  )
}
