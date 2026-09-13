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
  unreadCount: number
}

const MobileNavigationContext =
  createContext<MobileNavigationContextValue | null>(null)

export function useMobileNavigation() {
  return useContext(MobileNavigationContext)
}

export interface MobileNavigationProviderProps {
  children: ReactNode
  unreadCount?: number
}

export function MobileNavigationProvider({
  children,
  unreadCount = 0
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
    mql.addEventListener?.('change', onChange)
    return () => {
      mql.removeEventListener?.('change', onChange)
    }
  }, [])

  return (
    <MobileNavigationContext.Provider value={{ isOpen, setOpen, unreadCount }}>
      <Dialog open={isOpen} onOpenChange={setOpen}>
        {children}
      </Dialog>
    </MobileNavigationContext.Provider>
  )
}
