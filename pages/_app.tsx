import { Analytics } from '@vercel/analytics/react'
import 'bootstrap-icons/font/bootstrap-icons.css'
import 'bootstrap/dist/css/bootstrap.css'
import { SessionProvider } from 'next-auth/react'
import type { AppProps } from 'next/app'
import ReactModal from 'react-modal'

export default function App({
  Component,
  pageProps: { session, ...pageProps }
}: AppProps) {
  ReactModal.setAppElement('#__next')
  return (
    <SessionProvider session={session}>
      <Component {...pageProps} />
      <Analytics />
    </SessionProvider>
  )
}
