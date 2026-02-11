import { Metadata } from 'next'
import Link from 'next/link'
import { FC } from 'react'

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from '@/lib/components/ui/card'

import { ResetPasswordForm } from './ResetPasswordForm'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'Activities.next: Reset Password'
}

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

const Page: FC<Props> = async ({ searchParams }) => {
  const { code } = await searchParams
  const passwordResetCode = Array.isArray(code) ? code[0] : code

  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">Reset your password</CardTitle>
        <CardDescription>Set a new password for your account.</CardDescription>
      </CardHeader>
      <CardContent>
        <ResetPasswordForm initialCode={passwordResetCode} />
      </CardContent>
      <CardFooter className="justify-center">
        <p className="text-sm text-muted-foreground">
          Need a new reset link?{' '}
          <Link
            href="/auth/forgot-password"
            className="text-primary hover:underline"
          >
            Request one
          </Link>
        </p>
      </CardFooter>
    </Card>
  )
}

export default Page
