import { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { FC } from 'react'

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/lib/components/ui/card'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { isSafeInternalPath } from '@/lib/utils/isSafeInternalPath'

import { TwoFactorForm } from './TwoFactorForm'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'Activities.next: Two-Factor Authentication'
}

const getRedirectBack = (value: string | string[] | undefined): string => {
  const raw = Array.isArray(value) ? value[0] : value
  return isSafeInternalPath(raw) ? raw : '/'
}

const Page: FC<{
  searchParams: Promise<{ redirectBack?: string | string[] }>
}> = async ({ searchParams }) => {
  const session = await getServerAuthSession()
  const redirectBack = getRedirectBack((await searchParams).redirectBack)

  if (session?.user) {
    return redirect(redirectBack)
  }

  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">Two-factor authentication</CardTitle>
        <CardDescription>Enter your verification code</CardDescription>
      </CardHeader>
      <CardContent>
        <TwoFactorForm redirectBack={redirectBack} />
      </CardContent>
    </Card>
  )
}

export default Page
