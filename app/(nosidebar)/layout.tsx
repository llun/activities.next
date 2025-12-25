import { FC, ReactNode } from 'react'

import { Modal } from '../Modal'

interface LayoutProps {
  children: ReactNode
}

const Layout: FC<LayoutProps> = ({ children }) => {
  return (
    <div className="relative min-h-screen flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">{children}</div>
      <Modal />
    </div>
  )
}

export default Layout
