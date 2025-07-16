import 'bootstrap-icons/font/bootstrap-icons.css'
import 'bootstrap/dist/css/bootstrap.css'
import { Metadata } from 'next'
import { auth } from '@/auth'
import { FC, ReactNode } from 'react'

import { Header } from '@/lib/components/Header'
import { getDatabase } from '@/lib/database'

import { Modal } from '../Modal'

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
  const database = getDatabase()
  if (!database) {
    throw new Error('Fail to load database')
  }

  const session = await auth()
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
