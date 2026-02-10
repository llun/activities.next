'use client'

import { ArrowUp } from 'lucide-react'
import { FC, useEffect, useState } from 'react'

import { cn } from '@/lib/utils'

export const ScrollToTopButton: FC = () => {
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    const toggleVisibility = () => {
      // Show button when page is scrolled down more than 300px
      if (window.scrollY > 300) {
        setIsVisible(true)
      } else {
        setIsVisible(false)
      }
    }

    window.addEventListener('scroll', toggleVisibility)

    return () => {
      window.removeEventListener('scroll', toggleVisibility)
    }
  }, [])

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
