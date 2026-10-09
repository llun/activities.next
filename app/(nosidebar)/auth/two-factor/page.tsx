import { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { FC } from 'react'

import { AuthCard } from '@/app/(nosidebar)/AuthCard'
import { getAuthLogoSrc } from '@/app/(nosidebar)/getAuthLogoSrc'
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
    <AuthCard
      logoSrc={getAuthLogoSrc()}
      title="Two-factor authentication"
      description="Enter your verification code"
    >
      <TwoFactorForm redirectBack={redirectBack} />
    </AuthCard>
  )
}

export default Page
