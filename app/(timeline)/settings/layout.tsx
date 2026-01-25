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
    { name: 'General', url: '/settings' },
    { name: 'Account', url: '/settings/account' },
    { name: 'Media', url: '/settings/media' },
    { name: 'Notifications', url: '/settings/notifications' },
    { name: 'Sessions', url: '/settings/sessions' }
  ]

  return (
    <div className="space-y-6">
      <Tabs value={pathname} className="w-full">
        <TabsList>
          {tabs.map((tab) => (
            <Link key={tab.url} href={tab.url}>
              <TabsTrigger value={tab.url}>{tab.name}</TabsTrigger>
            </Link>
          ))}
        </TabsList>
      </Tabs>
      {children}
    </div>
  )
}

export default Layout
