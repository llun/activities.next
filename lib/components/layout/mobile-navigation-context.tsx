'use client'

import { usePathname } from 'next/navigation'
import {
  type ReactNode,
  createContext,
  useContext,
  useEffect,
  useState
} from 'react'

import { Dialog } from '@/lib/components/ui/dialog'

export interface MobileNavigationContextValue {
  isOpen: boolean
  setOpen: (open: boolean) => void
}

const MobileNavigationContext =
  createContext<MobileNavigationContextValue | null>(null)

export function useMobileNavigation() {
  return useContext(MobileNavigationContext)
}

export interface MobileNavigationProviderProps {
  children: ReactNode
}

/**
 * Owns the open state of the mobile navigation drawer and wraps its children
 * in the drawer's Radix Dialog root, so any `MobileNavigationTrigger` below it
 * opens the same drawer. Mounted by the signed-in `(timeline)` layout and by
 * the public shells, each with its own drawer content. Unread counts are not
 * part of it: they render on the drawer's rows, never on the menu button.
 */
export function MobileNavigationProvider({
  children
}: MobileNavigationProviderProps) {
  const [isOpen, setOpen] = useState(false)
  const pathname = usePathname()

  // Automatically close on client-side route changes
  useEffect(() => {
    setOpen(false)
  }, [pathname])

  // Automatically close when viewport expands to tablet / desktop size (>= 768px)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mql = window.matchMedia('(min-width: 768px)')
    const onChange = (e: MediaQueryListEvent | MediaQueryList) => {
      if (e.matches) {
        setOpen(false)
      }
    }
    if (mql.addEventListener) {
      mql.addEventListener('change', onChange)
    } else if (mql.addListener) {
      mql.addListener(onChange)
    }
    return () => {
      if (mql.removeEventListener) {
        mql.removeEventListener('change', onChange)
      } else if (mql.removeListener) {
        mql.removeListener(onChange)
      }
    }
  }, [])

  return (
    <MobileNavigationContext.Provider value={{ isOpen, setOpen }}>
      <Dialog open={isOpen} onOpenChange={setOpen}>
        {children}
      </Dialog>
    </MobileNavigationContext.Provider>
  )
}
