'use client'

import { ChevronDown } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { FC, ReactNode } from 'react'

import { Button } from '@/lib/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/lib/components/ui/dropdown-menu'
import { Tabs, TabsList, TabsTrigger } from '@/lib/components/ui/tabs'

interface Props {
  children: ReactNode
}

const Layout: FC<Props> = ({ children }) => {
  const pathname = usePathname()

  const tabs = [
    { name: 'General', url: '/settings/fitness/general' },
    { name: 'Privacy', url: '/settings/fitness/privacy' },
    { name: 'Strava', url: '/settings/fitness/strava' }
  ]

  const activeTab =
    tabs
      .filter(
        (tab) => pathname === tab.url || pathname.startsWith(`${tab.url}/`)
      )
      .sort((a, b) => b.url.length - a.url.length)[0] || tabs[0]

  return (
    <div className="space-y-6">
      <div className="md:hidden">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="w-full justify-between">
              {activeTab.name}
              <ChevronDown className="ml-2 h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-[--radix-dropdown-menu-trigger-width]">
            {tabs.map((tab) => (
              <DropdownMenuItem key={tab.url} asChild>
                <Link href={tab.url}>{tab.name}</Link>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="hidden md:block">
        <Tabs value={activeTab.url} className="w-full">
          <TabsList>
            {tabs.map((tab) => (
              <TabsTrigger key={tab.url} value={tab.url} asChild>
                <Link href={tab.url}>{tab.name}</Link>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {children}
    </div>
  )
}

export default Layout
