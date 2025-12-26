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
import { Input } from '@/lib/components/ui/input'
import { Label } from '@/lib/components/ui/label'
import { getDatabase } from '@/lib/database'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'Activities.next: Sign up'
}

const Page: FC = async () => {
  const database = getDatabase()
  if (!database) throw new Error('Database is not available')

  const session = await getServerSession(getAuthOptions())
  if (session && session.user) {
    return redirect('/')
  }

  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">Create an account</CardTitle>
        <CardDescription>Join Activities and start sharing</CardDescription>
      </CardHeader>
      <CardContent>
        <form method="post" action="/api/v1/accounts" className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="inputUsername">Username</Label>
            <Input name="username" type="text" id="inputUsername" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="inputEmail">Email</Label>
            <Input name="email" type="email" id="inputEmail" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="inputPassword">Password</Label>
            <Input name="password" type="password" id="inputPassword" />
          </div>

          <Button type="submit" className="w-full">
            Sign up
          </Button>
        </form>
      </CardContent>
      <CardFooter className="justify-center">
        <p className="text-sm text-muted-foreground">
          Already have an account?{' '}
          <Link href="/auth/signin" className="text-primary hover:underline">
            Sign in
          </Link>
        </p>
      </CardFooter>
    </Card>
  )
}

export default Page
