'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { FC, ReactNode } from 'react'

import { Tabs, TabsList, TabsTrigger } from '@/lib/components/ui/tabs'

interface Props {
  children: ReactNode
}

const Layout: FC<Props> = ({ children }) => {
  const pathname = usePathname()

  const tabs = [
    { name: 'Strava', url: '/settings/fitness/strava' },
    { name: 'Garmin', url: '/settings/fitness/garmin', disabled: true },
    { name: 'Wahoo', url: '/settings/fitness/wahoo', disabled: true }
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Fitness Settings</h1>
        <p className="text-sm text-muted-foreground">
          Connect your fitness tracking services to automatically share your
          activities.
        </p>
      </div>

      <Tabs value={pathname} className="w-full">
        <TabsList>
          {tabs.map((tab) => (
            <Link key={tab.url} href={tab.url} className={tab.disabled ? 'pointer-events-none' : ''}>
              <TabsTrigger value={tab.url} disabled={tab.disabled}>
                {tab.name}
                {tab.disabled && (
                  <span className="ml-1 text-xs text-muted-foreground">(Coming Soon)</span>
                )}
              </TabsTrigger>
            </Link>
          ))}
        </TabsList>
      </Tabs>
      {children}
    </div>
  )
}

export default Layout
