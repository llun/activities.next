import { FC } from 'react'

interface AgreementLabelProps {
  terms: boolean
  privacy: boolean
  // What the person is joining ("Run Club").
  name: string
}

const LINK_CLASS = 'text-primary-text underline hover:no-underline'

// "I agree to the terms of service and privacy policy of Run Club." naming
// only the documents the domain has. The links open in a new tab so the form
// the visitor is filling in stays as it is.
export const AgreementLabel: FC<AgreementLabelProps> = ({
  terms,
  privacy,
  name
}) => (
  <>
    I agree to the{' '}
    {terms ? (
      <a
        href="/terms-of-service"
        target="_blank"
        rel="noopener noreferrer"
        className={LINK_CLASS}
      >
        terms of service
      </a>
    ) : null}
    {terms && privacy ? ' and ' : null}
    {privacy ? (
      <a
        href="/privacy-policy"
        target="_blank"
        rel="noopener noreferrer"
        className={LINK_CLASS}
      >
        privacy policy
      </a>
    ) : null}{' '}
    of {name}.
  </>
)
