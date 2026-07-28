// Descriptors for the admin "Configure environment" builder on Posts & media.
//
// Some infrastructure is deliberately environment-only — it is read once at
// boot and never from the database (media storage, the fitness map provider).
// The builder assembles a copy-pasteable `.env` block from these descriptors so
// an admin does not have to hunt through the docs for variable names; it never
// reads or writes a value itself.
//
// The variable *names* live in lib/config because environment variable name
// constants must stay inside it (see AGENTS.md, enforced by envAccess.test.ts).
// This module deliberately reads nothing from process.env, so the admin Client
// Component can import it.

export interface EnvTemplateField {
  // Environment variable this input fills in.
  name: string
  label: string
  placeholder: string
  // Left out of the generated block until the admin types a value. Required
  // fields always appear, carrying their placeholder as a visible to-do.
  optional?: boolean
  // Masked in the preview, included verbatim when copied.
  secret?: boolean
  // Spans both columns of the two-column field grid.
  wide?: boolean
}

export interface EnvTemplateChoice {
  // Value written to the area's selector variable.
  value: string
  label: string
  fields: EnvTemplateField[]
  // Extra sentence appended to the selector help for this choice.
  note?: string
}

interface EnvTemplateAreaBase {
  value: string
  // Label in the "Environment area" dropdown.
  label: string
  // Sentence fragment used in the "the server reads … from the environment"
  // notice.
  subject: string
  // Help line under the "Environment area" dropdown.
  blurb: string
}

/**
 * An area is one of two shapes.
 *
 * `choice` areas pick a backend and the fields follow from it (storage type,
 * map provider). `fields` areas have no backend to choose — every variable is
 * filled in the same way every time — so they render the inputs directly. A
 * one-option dropdown would be the alternative, and a select the admin can
 * never change is worse than no select.
 */
export type EnvTemplateArea =
  | (EnvTemplateAreaBase & {
      kind: 'choice'
      // The variable the choice selector writes, and its label.
      selectorLabel: string
      selectorName: string
      choices: EnvTemplateChoice[]
      defaultChoice: string
    })
  | (EnvTemplateAreaBase & {
      kind: 'fields'
      fields: EnvTemplateField[]
    })

// The whole media-storage family is environment-only, so the read-only backend
// field on Posts & media names the family rather than one variable.
export const MEDIA_STORAGE_ENV_PREFIX = 'ACTIVITIES_MEDIA_STORAGE_*'

// Reply by email is likewise environment-only on the inbound side: the admin
// switch on Posts & media can only turn OFF something these variables turned on.
export const EMAIL_INBOUND_ENV_PREFIX = 'ACTIVITIES_EMAIL_INBOUND_*'

// The outbound half. Not in the builder — each provider has its own field set,
// and the reply-by-email help line only needs to name it as the blocker.
export const EMAIL_OUTBOUND_ENV_PREFIX = 'ACTIVITIES_EMAIL_*'

const MEDIA_STORAGE_FILESYSTEM_FIELDS: EnvTemplateField[] = [
  {
    name: 'ACTIVITIES_MEDIA_STORAGE_PATH',
    label: 'Media directory',
    placeholder: './uploads',
    wide: true
  }
]

const MEDIA_STORAGE_S3_FIELDS: EnvTemplateField[] = [
  {
    name: 'ACTIVITIES_MEDIA_STORAGE_BUCKET',
    label: 'Bucket',
    placeholder: 'media.example.social'
  },
  {
    name: 'ACTIVITIES_MEDIA_STORAGE_REGION',
    label: 'Region',
    placeholder: 'eu-central-1'
  },
  {
    name: 'ACTIVITIES_MEDIA_STORAGE_ENDPOINT',
    label: 'Endpoint — optional, for R2 / MinIO',
    // A non-AWS example on purpose: leaving this unset is what selects AWS, so
    // an AWS URL here would illustrate the one value nobody should set.
    placeholder: 'https://<account>.r2.cloudflarestorage.com',
    optional: true,
    wide: true
  },
  {
    name: 'ACTIVITIES_MEDIA_STORAGE_HOSTNAME',
    label: 'Public hostname or CDN — optional',
    placeholder: 'media.example.social',
    optional: true,
    wide: true
  },
  // Credentials are not ACTIVITIES_* variables: the AWS SDK resolves them from
  // its standard chain, so these are the plain AWS names.
  {
    name: 'AWS_ACCESS_KEY_ID',
    label: 'Access key ID',
    placeholder: 'AKIA0000EXAMPLE',
    optional: true
  },
  {
    name: 'AWS_SECRET_ACCESS_KEY',
    label: 'Secret access key',
    placeholder: 'your-secret-access-key',
    secret: true,
    optional: true
  }
]

const FITNESS_MAPBOX_FIELDS: EnvTemplateField[] = [
  {
    name: 'ACTIVITIES_FITNESS_MAPBOX_ACCESS_TOKEN',
    label: 'Access token',
    placeholder: 'pk.eyJ1Ijoi…',
    secret: true,
    wide: true
  }
]

const FITNESS_APPLE_MAPS_FIELDS: EnvTemplateField[] = [
  {
    name: 'ACTIVITIES_FITNESS_APPLE_MAPS_TEAM_ID',
    label: 'Team ID',
    placeholder: '4B93FXY2A9'
  },
  {
    name: 'ACTIVITIES_FITNESS_APPLE_MAPS_KEY_ID',
    label: 'Key ID',
    placeholder: '7G8HQZ2XKD'
  },
  {
    name: 'ACTIVITIES_FITNESS_APPLE_MAPS_PRIVATE_KEY',
    label: 'Private key (.p8), PEM',
    // The resolver expands a single-line, \n-escaped PEM back into a real key,
    // which is the only form that survives a one-line .env value.
    placeholder: '-----BEGIN PRIVATE KEY-----\\nMIGTAgEAMBMGByqGSM49…',
    secret: true,
    wide: true
  }
]

// Reply by email needs no backend choice: the provider is whatever POSTs the
// webhook, and these three variables describe it the same way whichever one it
// is. Both the secret and the domain are required — setting only one disables
// the feature rather than half-enabling it.
const REPLY_BY_EMAIL_FIELDS: EnvTemplateField[] = [
  {
    name: 'ACTIVITIES_EMAIL_INBOUND_DOMAIN',
    label: 'Inbound domain',
    placeholder: 'reply.example.social'
  },
  {
    name: 'ACTIVITIES_EMAIL_INBOUND_LOCAL_PART_PREFIX',
    label: 'Address prefix — optional, defaults to reply',
    placeholder: 'reply',
    optional: true
  },
  {
    name: 'ACTIVITIES_EMAIL_INBOUND_SECRET',
    label: 'Webhook signing secret — generate with `openssl rand -hex 32`',
    // A required field carries its placeholder into the block as a visible
    // to-do, so a secret's placeholder has to be unmistakably a stub. Naming
    // the command here instead would put a runnable line where the value goes,
    // and `min(1)` accepts it: the instance would then verify every inbound
    // webhook against a signing key published in this repository.
    placeholder: 'your-webhook-signing-secret',
    secret: true,
    wide: true
  }
]

export const ENV_TEMPLATE_AREAS: EnvTemplateArea[] = [
  {
    kind: 'choice',
    value: 'storage',
    label: 'Media storage — filesystem or S3',
    subject: 'storage',
    blurb: 'Where uploaded media lives.',
    selectorLabel: 'Storage type',
    selectorName: 'ACTIVITIES_MEDIA_STORAGE_TYPE',
    defaultChoice: 's3',
    choices: [
      {
        value: 'fs',
        label: 'Local filesystem — simplest, single server',
        fields: MEDIA_STORAGE_FILESYSTEM_FIELDS
      },
      {
        value: 's3',
        label: 'S3-compatible — AWS S3, Cloudflare R2, MinIO',
        fields: MEDIA_STORAGE_S3_FIELDS,
        note: 'Credentials come from the standard AWS chain — leave the key fields empty when the host already supplies an IAM role.'
      }
    ]
  },
  {
    kind: 'choice',
    value: 'maps',
    label: 'Fitness maps — route maps & heatmaps',
    subject: 'fitness maps',
    blurb: 'Powers activity route maps and heatmaps.',
    selectorLabel: 'Map provider',
    selectorName: 'ACTIVITIES_FITNESS_MAP_PROVIDER',
    defaultChoice: 'mapbox',
    choices: [
      {
        value: 'osm',
        label: 'OpenStreetMap — no key needed',
        fields: [],
        note: 'OpenStreetMap needs no credentials — this one line is the whole block.'
      },
      {
        value: 'mapbox',
        label: 'Mapbox',
        fields: FITNESS_MAPBOX_FIELDS,
        note: 'Only a public pk.* token reaches browser maps; a secret sk.* token stays server-side and the browser falls back to OpenStreetMap.'
      },
      {
        value: 'apple',
        label: 'Apple Maps',
        fields: FITNESS_APPLE_MAPS_FIELDS,
        note: 'All three values are required; with any of them missing the provider falls back to OpenStreetMap.'
      }
    ]
  },
  {
    kind: 'fields',
    value: 'reply-by-email',
    label: 'Reply by email — answer notifications by replying',
    subject: 'inbound email',
    blurb:
      'Lets people answer a mention or reply notification by replying to the email. Needs the outbound ACTIVITIES_EMAIL_* settings too, and an MX record for the domain below pointing at whichever provider posts the webhook.',
    fields: REPLY_BY_EMAIL_FIELDS
  }
]
