import { UTCDate } from '@date-fns/utc'
import { format } from 'date-fns/format'
import parse from 'html-react-parser'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { FC } from 'react'

import { MobileCompactHeader } from '@/lib/components/layout/mobile-compact-header'
import { getVisitedDomainIdentity } from '@/lib/services/domains/domainIdentity'
import { renderPolicyMarkdown } from '@/lib/utils/text/renderPolicyMarkdown'

export type PolicyKind = 'terms' | 'privacy'

const POLICIES = {
  terms: { title: 'Terms of service', href: '/terms-of-service' },
  privacy: { title: 'Privacy policy', href: '/privacy-policy' }
} as const

// The document is sanitized HTML (see renderPolicyMarkdown), parsed into
// elements rather than injected. The classes style the elements it can hold.
const DOCUMENT_CLASS = [
  'mt-7 max-md:mt-5 text-base leading-[1.75] max-md:leading-[1.625] break-words',
  '[&_h1]:mt-9 [&_h1]:text-[22px] [&_h1]:leading-[30px] [&_h1]:font-semibold',
  '[&_h2]:mt-9 [&_h2]:text-[22px] [&_h2]:leading-[30px] [&_h2]:font-semibold max-md:[&_h2]:mt-7 max-md:[&_h2]:text-xl',
  '[&_h3]:mt-7 [&_h3]:text-lg [&_h3]:leading-7 [&_h3]:font-semibold',
  '[&_h4]:mt-6 [&_h4]:text-base [&_h4]:font-semibold [&_h5]:mt-6 [&_h5]:font-semibold [&_h6]:mt-6 [&_h6]:font-semibold',
  '[&_h2+*]:mt-2 [&_h3+*]:mt-2 [&_h4+*]:mt-2 [&_h5+*]:mt-2 [&_h6+*]:mt-2',
  '[&_p]:mt-4 [&_ul]:mt-2 [&_ol]:mt-2 [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-[22px] [&_ol]:pl-[22px]',
  '[&_li]:mt-1.5 [&_li>p]:mt-1.5',
  '[&_a]:text-(color:--link-color) [&_a:hover]:text-(color:--link-color-hover) [&_a]:underline [&_a:hover]:no-underline',
  '[&_blockquote]:mt-4 [&_blockquote]:border-l-4 [&_blockquote]:pl-4 [&_blockquote]:text-muted-foreground',
  '[&_code]:bg-muted [&_code]:rounded [&_code]:px-1 [&_code]:font-mono [&_code]:text-sm',
  '[&_pre]:bg-muted [&_pre]:mt-4 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:p-4 [&_pre_code]:bg-transparent [&_pre_code]:p-0',
  '[&_hr]:my-8 [&_hr]:border-t',
  '[&_table]:mt-4 [&_table]:block [&_table]:overflow-x-auto [&_table]:text-sm [&_th]:border [&_th]:px-3 [&_th]:py-1.5 [&_th]:text-left [&_td]:border [&_td]:px-3 [&_td]:py-1.5'
].join(' ')

const footerLinkClass =
  'text-muted-foreground hover:text-foreground underline underline-offset-2'

interface PolicyDocumentPageProps {
  kind: PolicyKind
}

/**
 * The visited domain's terms of service or privacy policy as a public page:
 * the title, when it last changed (UTC, omitted when the document has no date),
 * the rendered Markdown and a footer linking the other document, the contact
 * email and the project. Not found when the domain has no such document.
 */
export const PolicyDocumentPage: FC<PolicyDocumentPageProps> = async ({
  kind
}) => {
  const identity = await getVisitedDomainIdentity()
  const policy =
    kind === 'terms' ? identity.termsOfService : identity.privacyPolicy
  if (!policy) notFound()

  const { title } = POLICIES[kind]
  const other = kind === 'terms' ? 'privacy' : 'terms'
  const otherPolicy =
    other === 'terms' ? identity.termsOfService : identity.privacyPolicy
  const html = renderPolicyMarkdown(policy.markdown, {
    domain: identity.domain,
    forPage: { title }
  })
  // Formatted here in UTC and passed as text: the server cannot know the
  // reader's zone, and this page has no client part to adjust it.
  const updatedAt =
    policy.updatedAt === null ? null : new UTCDate(policy.updatedAt)

  return (
    <>
      {/* Signed-in phones need the menu button; renders nothing without the
          navigation provider, so logged-out pages are unchanged. */}
      <MobileCompactHeader title={title} as="p" />
      <article>
        <h1 className="text-[28px] leading-9 font-bold tracking-tight md:text-4xl md:leading-[44px]">
          {title}
        </h1>
        {updatedAt ? (
          <p className="text-muted-foreground mt-1.5 text-sm md:mt-2">
            Last updated{' '}
            <time dateTime={updatedAt.toISOString()}>
              {format(updatedAt, 'd MMMM yyyy')}
            </time>
          </p>
        ) : null}
        <div className={DOCUMENT_CLASS}>{parse(html)}</div>
        <footer className="text-muted-foreground mt-12 flex flex-col gap-1.5 border-t pt-5 text-sm md:flex-row md:flex-wrap md:justify-center md:gap-x-5">
          {otherPolicy ? (
            <>
              <Link href={POLICIES[other].href} className={footerLinkClass}>
                {POLICIES[other].title}
              </Link>
              <span aria-hidden="true" className="max-md:hidden">
                &middot;
              </span>
            </>
          ) : null}
          {identity.contactEmail ? (
            <>
              <span>
                Contact{' '}
                <a
                  href={`mailto:${identity.contactEmail}`}
                  className={footerLinkClass}
                >
                  {identity.contactEmail}
                </a>
              </span>
              <span aria-hidden="true" className="max-md:hidden">
                &middot;
              </span>
            </>
          ) : null}
          <span>
            Powered by{' '}
            <a
              href="https://github.com/llun/activities.next"
              target="_blank"
              rel="noopener noreferrer"
              className={footerLinkClass}
            >
              Activities.next
            </a>
          </span>
        </footer>
      </article>
    </>
  )
}
