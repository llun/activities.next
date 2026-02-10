'use client'

import { ArrowUp } from 'lucide-react'
import { FC, useCallback, useEffect, useRef, useState } from 'react'

import { cn } from '@/lib/utils'

export const ScrollToTopButton: FC = () => {
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

  return (
    <button
      onClick={scrollToTop}
      className={cn(
        'fixed bottom-20 right-4 z-50 rounded-full bg-primary text-primary-foreground shadow-lg transition-all duration-300 hover:bg-primary/90 md:hidden',
        isVisible
          ? 'opacity-100 translate-y-0'
          : 'opacity-0 translate-y-10 pointer-events-none'
      )}
      aria-label="Scroll to top"
    >
      <div className="p-3">
        <ArrowUp className="h-6 w-6" />
      </div>
    </button>
  )
}
