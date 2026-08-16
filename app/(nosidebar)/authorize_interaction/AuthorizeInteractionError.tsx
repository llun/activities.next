import Link from 'next/link'
import { FC } from 'react'

import { Button } from '@/lib/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from '@/lib/components/ui/card'

interface AuthorizeInteractionErrorProps {
  title: string
  description: string
  uri?: string
}

export const AuthorizeInteractionError: FC<AuthorizeInteractionErrorProps> = ({
  title,
  description,
  uri
}) => (
  <Card>
    <CardHeader className="text-center">
      <CardTitle className="text-2xl">{title}</CardTitle>
      <CardDescription>{description}</CardDescription>
    </CardHeader>
    {uri ? (
      <CardContent>
        {/* The value is whatever a remote server put in the query string, so it
            is rendered as inert text — never as a link. */}
        <code className="block wrap-anywhere rounded-md bg-muted p-3 text-sm">
          {uri}
        </code>
      </CardContent>
    ) : null}
    <CardFooter className="flex justify-center">
      <Button variant="outline" asChild>
        <Link href="/">Back to home</Link>
      </Button>
    </CardFooter>
  </Card>
)
