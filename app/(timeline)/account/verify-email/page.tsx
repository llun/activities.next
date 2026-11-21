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
  title: 'Verify email'
}

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

const first = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value

const Page: FC<Props> = async ({ searchParams }) => {
  const database = getDatabase()
  if (!database) {
    throw new Error('Database is not available')
  }

  const params = await searchParams
  const verificationCode = first(params.code)
  const status = first(params.status)

  // Check if user is logged in to provide better navigation
  const session = await getServerAuthSession()
  const actor = await getActorFromSession(database, session)
  const isLoggedIn = !!(actor && actor.account)

  const destination = isLoggedIn
    ? { href: '/account/email', label: 'Go to Email & name' }
    : { href: '/auth/signin', label: 'Sign in' }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Verify email"
        description="Confirm a change to the email address on your account."
      />

      <Section title="Email change">
        {status === 'verified' ? (
          <Alert
            tone="success"
            title="Email verified"
            action={
              <Button asChild>
                <Link href={destination.href}>{destination.label}</Link>
              </Button>
            }
          >
            Your email address has been changed. You can now use your new email
            address to sign in.
            {!isLoggedIn ? (
              <span className="text-foreground mt-1 block font-medium">
                Please sign in with your new email address.
              </span>
            ) : null}
          </Alert>
        ) : status === 'invalid' ? (
          <Alert
            tone="error"
            title="Verification failed"
            action={
              <Button asChild>
                <Link href={destination.href}>{destination.label}</Link>
              </Button>
            }
          >
            The verification link is invalid or has expired. Please request a
            new email change from your account settings.
          </Alert>
        ) : verificationCode ? (
          // GET is read-only: the change is applied by the POST this button
          // sends, so a mail scanner that opens the link cannot consume it.
          <Alert
            tone="info"
            live={false}
            title="Confirm email change"
            action={
              <form
                method="post"
                action="/api/v1/accounts/email/verify/confirm"
              >
                <input type="hidden" name="code" value={verificationCode} />
                <Button type="submit">Confirm email change</Button>
              </form>
            }
          >
            Press confirm to apply the change to your email address.
          </Alert>
        ) : (
          <Alert
            tone="info"
            live={false}
            title="Open the link from your email"
            action={
              <Button asChild>
                <Link href={destination.href}>{destination.label}</Link>
              </Button>
            }
          >
            This page confirms an email change. Open the verification link we
            sent to the new address to continue.
          </Alert>
        )}
      </Section>
    </div>
  )
}

export default Page
