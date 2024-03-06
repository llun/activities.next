import 'bootstrap-icons/font/bootstrap-icons.css'
import 'bootstrap/dist/css/bootstrap.css'
import { Metadata } from 'next'
import { getServerSession } from 'next-auth'
import { FC, ReactNode } from 'react'

import { Header } from '@/lib/components/Header'
import { getStorage } from '@/lib/storage'

import { Modal } from '../Modal'
import { getAuthOptions } from '../api/auth/[...nextauth]/authOptions'

export const viewport = {
  width: 'device-width',
  initialScale: 1
}

export const metadata: Metadata = {
  title: 'Activities.next'
}

interface LayoutProps {
  children: ReactNode
}

const Layout: FC<LayoutProps> = async ({ children }) => {
  const [storage, session] = await Promise.all([
    getStorage(),
    getServerSession(getAuthOptions())
  ])

  if (!storage) {
    throw new Error('Fail to load storage')
  }

  return (
    <html lang="en">
      <body className="">
        <Header session={session} />
        <section className="container pt-4">
          <div className="row">{children}</div>
        </section>
        <Modal />
      </body>
    </html>
  )
}

export default Layout
