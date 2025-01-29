import { Metadata } from 'next'
import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { FC } from 'react'

import { getAuthOptions } from '@/app/api/auth/[...nextauth]/authOptions'
import { getDatabase } from '@/lib/database'
import { Database } from '@/lib/database/types'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'Activities.next: Confirm account'
}

const isVerify = async (database: Database, verificationCode?: string) => {
  if (!verificationCode) return false
  return database.verifyAccount({ verificationCode })
}

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}
const Page: FC<Props> = async ({ searchParams }) => {
  const [database, session] = await Promise.all([
    getDatabase(),
    getServerSession(getAuthOptions())
  ])

  if (!database) throw new Error('Database is not available')
  if (session && session.user) {
    return redirect('/')
  }

  const { verificationCode } = await searchParams
  const code = Array.isArray(verificationCode)
    ? verificationCode[0]
    : verificationCode
  const isAccountVerify = Boolean(await isVerify(database, code))

  return (
    <h1>
      {isAccountVerify
        ? 'Your account is verified'
        : 'Invalid verification code'}
    </h1>
  )
}

export default Page
