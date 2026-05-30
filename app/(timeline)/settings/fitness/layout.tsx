'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { FC, ReactNode } from 'react'

import { cn } from '@/lib/utils'

interface Props {
  children: ReactNode
}

const tabs = [
  { name: 'General', url: '/settings/fitness/general' },
  { name: 'Privacy', url: '/settings/fitness/privacy' },
  { name: 'Strava', url: '/settings/fitness/strava' }
]

const Layout: FC<Props> = ({ children }) => {
  const pathname = usePathname()

  const activeTab =
    tabs
      .filter(
        (tab) => pathname === tab.url || pathname.startsWith(`${tab.url}/`)
      )
      .sort((a, b) => b.url.length - a.url.length)[0] || tabs[0]

  return (
    <div className="space-y-6">
      {/* Nested fitness sub-nav: an in-content segmented control. */}
      <nav aria-label="Fitness settings">
        <div className="inline-flex gap-1 rounded-lg bg-muted p-1">
          {tabs.map((tab) => {
            const isActive = tab.url === activeTab.url
            return (
              <Link
                key={tab.url}
                href={tab.url}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {tab.name}
              </Link>
            )
          })}
        </div>
      </nav>

      {children}
    </div>
  )
}

export default Layout
