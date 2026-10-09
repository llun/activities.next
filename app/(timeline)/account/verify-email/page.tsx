import { Metadata } from 'next'
import Link from 'next/link'
import { FC } from 'react'

import { PageHeader } from '@/lib/components/page-header'
import { Alert } from '@/lib/components/surface/Alert'
import { Section } from '@/lib/components/surface/Section'
import { Button } from '@/lib/components/ui/button'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'Activities.next: Verify email'
}

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

const Page: FC<Props> = async ({ searchParams }) => {
  const database = getDatabase()
  if (!database) {
    throw new Error('Database is not available')
  }

  const { code } = await searchParams
  const verificationCode = Array.isArray(code) ? code[0] : code

  let isSuccess = false
  let newEmail = ''

  if (verificationCode) {
    // Try to verify the email change without requiring authentication
    // The database method will find the account by the verification code
    const updatedAccount = await database.verifyEmailChange({
      emailChangeCode: verificationCode
    })

    if (updatedAccount) {
      isSuccess = true
      newEmail = updatedAccount.email
    }
  }

  // Check if user is logged in to provide better navigation
  const session = await getServerAuthSession()
  const actor = await getActorFromSession(database, session)
  const isLoggedIn = !!(actor && actor.account)

  const destination = isLoggedIn
    ? { href: '/account', label: 'Go to account' }
    : { href: '/auth/signin', label: 'Sign in' }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Verify email"
        description="Confirm a change to the email address on your account."
      />

      <Section title="Email change">
        <Alert
          tone={isSuccess ? 'success' : 'error'}
          title={isSuccess ? 'Email verified' : 'Verification failed'}
          action={
            <Button asChild>
              <Link href={destination.href}>{destination.label}</Link>
            </Button>
          }
        >
          {isSuccess ? (
            <>
              Your email has been successfully changed to {newEmail}. You can
              now use your new email address to sign in.
              {!isLoggedIn ? (
                <span className="text-foreground mt-1 block font-medium">
                  Please sign in with your new email address.
                </span>
              ) : null}
            </>
          ) : (
            'The verification link is invalid or has expired. Please request a new email change from your account settings.'
          )}
        </Alert>
      </Section>
    </div>
  )
}

export default Page
