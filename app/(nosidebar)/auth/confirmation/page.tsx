import { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { FC } from 'react'

import { AuthCard } from '@/app/(nosidebar)/AuthCard'
import { getAuthLogoSrc } from '@/app/(nosidebar)/getAuthLogoSrc'
import { Alert } from '@/lib/components/surface/Alert'
import { Button } from '@/lib/components/ui/button'
import { getDatabase } from '@/lib/database'
import { Database } from '@/lib/database/types'
import { getServerAuthSession } from '@/lib/services/auth/getSession'

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
    getServerAuthSession()
  ])

  if (!database) throw new Error('Database is not available')

  const { verificationCode } = await searchParams
  const code = Array.isArray(verificationCode)
    ? verificationCode[0]
    : verificationCode

  if (!code && session && session.user) {
    return redirect('/')
  }

  const isAccountVerify = Boolean(await isVerify(database, code))

  return (
    <AuthCard logoSrc={getAuthLogoSrc()} title="Confirm your account">
      {isAccountVerify ? (
        <>
          <Alert tone="success" live={false} title="Your account is verified" />
          <Button asChild className="w-full">
            <Link href="/auth/signin">Continue to sign in</Link>
          </Button>
        </>
      ) : (
        <>
          <Alert live={false} title="Invalid verification code">
            Check that you opened the whole link from your email.
          </Alert>
          <Button asChild variant="outline" className="w-full">
            <Link href="/auth/signin">Back to sign in</Link>
          </Button>
        </>
      )}
    </AuthCard>
  )
}

export default Page
