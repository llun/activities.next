'use client'

import { usePathname, useRouter } from 'next/navigation'
import { FC, ReactNode } from 'react'

import { Tabs, TabsList, TabsTrigger } from '@/lib/components/ui/tabs'

interface Props {
  children: ReactNode
}

const Layout: FC<Props> = ({ children }) => {
  const router = useRouter()
  const pathname = usePathname()

  const tabs = [
    { name: 'Strava', url: '/settings/fitness/strava' }
    // Future services can be added here:
    // { name: 'Garmin', url: '/settings/fitness/garmin', disabled: true },
    // { name: 'Wahoo', url: '/settings/fitness/wahoo', disabled: true }
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

      <Tabs
        value={pathname}
        onValueChange={(value) => router.push(value)}
        className="w-full"
      >
        <TabsList>
          {tabs.map((tab) => (
            <TabsTrigger key={tab.url} value={tab.url}>
              {tab.name}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {children}
    </div>
  )
}

export default Layout
