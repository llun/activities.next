'use client'

import { signOut } from 'next-auth/react'

import { Button } from '@/lib/components/ui/button'

export const LogoutButton = () => (
  <Button variant="outline" onClick={() => signOut()}>
    Logout
  </Button>
)
