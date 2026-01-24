import { Metadata } from 'next'
import { getServerSession } from 'next-auth'
import Link from 'next/link'
import { FC } from 'react'

import { getAuthOptions } from '@/app/api/auth/[...nextauth]/authOptions'
import { Button } from '@/lib/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from '@/lib/components/ui/card'
import { getDatabase } from '@/lib/database'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'Activities.next: Verify Email'
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
  const session = await getServerSession(getAuthOptions())
  const actor = await getActorFromSession(database, session)
  const isLoggedIn = !!(actor && actor.account)

  return (
    <div className="flex min-h-screen items-center justify-center">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">
            {isSuccess ? 'Email Verified!' : 'Verification Failed'}
          </CardTitle>
          <CardDescription>
            {isSuccess
              ? `Your email has been successfully changed to ${newEmail}`
              : 'The verification link is invalid or has expired'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isSuccess ? (
            <div className="space-y-2 text-center">
              <p className="text-sm text-muted-foreground">
                You can now use your new email address to sign in.
              </p>
              {!isLoggedIn && (
                <p className="text-sm font-medium">
                  Please sign in with your new email address.
                </p>
              )}
            </div>
          ) : (
            <p className="text-center text-sm text-muted-foreground">
              Please request a new email change from your account settings.
            </p>
          )}
        </CardContent>
        <CardFooter className="justify-center gap-2">
          {isSuccess && !isLoggedIn ? (
            <Link href="/auth/signin">
              <Button>Sign In</Button>
            </Link>
          ) : isLoggedIn ? (
            <Link href="/settings/account">
              <Button>Go to Account Settings</Button>
            </Link>
          ) : (
            <Link href="/auth/signin">
              <Button>Sign In</Button>
            </Link>
          )}
        </CardFooter>
      </Card>
    </div>
  )
}

export default Page
