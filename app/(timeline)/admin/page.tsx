import {
  Activity,
  Database as DatabaseIcon,
  HardDrive,
  Image,
  MessageSquare,
  Users
} from 'lucide-react'
import { redirect } from 'next/navigation'

import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { formatFileSize } from '@/lib/utils/formatFileSize'
import { getAdminFromSession } from '@/lib/utils/getAdminFromSession'

export const dynamic = 'force-dynamic'

const Page = async () => {
  const database = getDatabase()
  if (!database) throw new Error('Failed to load database')

  const session = await getServerAuthSession()
  const admin = await getAdminFromSession(database, session)
  if (!admin) return redirect('/')

  const stats = await database.getServiceStats()

  const statCards = [
    {
      label: 'Total Accounts',
      value: stats.totalAccounts.toLocaleString(),
      icon: Users
    },
    {
      label: 'Total Actors',
      value: stats.totalActors.toLocaleString(),
      icon: DatabaseIcon
    },
    {
      label: 'Total Statuses',
      value: stats.totalStatuses.toLocaleString(),
      icon: MessageSquare
    },
    {
      label: 'Total Media Files',
      value: stats.totalMediaFiles.toLocaleString(),
      icon: Image
    },
    {
      label: 'Media Storage',
      value: formatFileSize(stats.totalMediaBytes),
      icon: HardDrive
    },
    {
      label: 'Total Fitness Files',
      value: stats.totalFitnessFiles.toLocaleString(),
      icon: Activity
    },
    {
      label: 'Fitness Storage',
      value: formatFileSize(stats.totalFitnessBytes),
      icon: HardDrive
    }
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Overview</h1>
        <p className="text-sm text-muted-foreground">
          Service usage statistics
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {statCards.map((card) => (
          <div
            key={card.label}
            className="rounded-2xl border bg-background/80 p-6 shadow-sm"
          >
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-primary/10 p-2">
                <card.icon className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{card.label}</p>
                <p className="text-2xl font-bold">{card.value}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default Page
