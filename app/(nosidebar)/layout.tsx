import 'bootstrap-icons/font/bootstrap-icons.css'
import 'bootstrap/dist/css/bootstrap.css'
import { Metadata } from 'next'
import { FC, ReactNode } from 'react'

import { auth } from '@/auth'
import { Header } from '@/lib/components/Header'
import { getStorage } from '@/lib/storage'

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
  const [storage, session] = await Promise.all([getStorage(), auth()])

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
