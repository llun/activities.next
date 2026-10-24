import { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { AccountIdentityCard } from '@/app/(timeline)/account/AccountIdentityCard'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'
import { isRealAvatar } from '@/lib/utils/isRealAvatar'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Account & security'
}

// The Account index at every width: only the identity card; the section layout
// lists the sections under it.
const Page = async ({
  searchParams
}: {
  searchParams: Promise<{ error?: string }>
}) => {
  const database = getDatabase()
  if (!database) {
    throw new Error('Failed to load database')
  }

  const session = await getServerAuthSession()
  const actor = await getActorFromSession(database, session)
  if (!actor || !actor.account) {
    return redirect('/auth/signin')
  }

  // Old image-upload error links pointed here.
  const { error } = await searchParams
  if (error) {
    return redirect(`/account/email?error=${encodeURIComponent(error)}`)
  }

  const account = actor.account
  return (
    <AccountIdentityCard
      name={account.name}
      email={account.email}
      iconUrl={isRealAvatar(account.iconUrl) ? account.iconUrl : null}
    />
  )
}

export default Page
