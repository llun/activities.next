import { Metadata } from 'next'
import { getServerSession } from 'next-auth'
import Link from 'next/link'
import { redirect } from 'next/navigation'
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

  const session = await getServerSession(getAuthOptions())
  const actor = await getActorFromSession(database, session)
  
  if (!actor || !actor.account) {
    return redirect('/auth/signin')
  }

  const { code } = await searchParams
  const verificationCode = Array.isArray(code) ? code[0] : code

  let isSuccess = false
  let newEmail = ''

  if (verificationCode) {
    const updatedAccount = await database.verifyEmailChange({
      accountId: actor.account.id,
      emailChangeCode: verificationCode
    })

    if (updatedAccount) {
      isSuccess = true
      newEmail = updatedAccount.email
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">
            {isSuccess ? 'Email Verified!' : 'Verification Failed'}
          </CardTitle>
          <CardDescription>
            {isSuccess
              ? `Your email has been changed to ${newEmail}`
              : 'The verification link is invalid or has expired'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isSuccess ? (
            <p className="text-center text-sm text-muted-foreground">
              You can now use your new email address to sign in.
            </p>
          ) : (
            <p className="text-center text-sm text-muted-foreground">
              Please request a new email change from your account settings.
            </p>
          )}
        </CardContent>
        <CardFooter className="justify-center">
          <Link href="/settings/account">
            <Button>Go to Account Settings</Button>
          </Link>
        </CardFooter>
      </Card>
    </div>
  )
}

export default Page
