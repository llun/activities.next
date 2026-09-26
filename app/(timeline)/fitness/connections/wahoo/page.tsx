import { redirect } from 'next/navigation'
import { FC } from 'react'

import { WahooSettingsForm } from '@/app/(timeline)/fitness/wahoo/WahooSettingsForm'
import { Card } from '@/lib/components/ui/card'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

export const dynamic = 'force-dynamic'

const WahooPage: FC = async () => {
  const database = getDatabase()
  if (!database) {
    throw new Error('Fail to load database')
  }

  const session = await getServerAuthSession()
  const actor = await getActorFromSession(database, session)
  if (!actor || !actor.account) {
    return redirect('/auth/signin')
  }

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <WahooSettingsForm />
      </Card>
    </div>
  )
}

export default WahooPage
