/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import { ReactNode } from 'react'

import type { ActorProfile } from '@/lib/types/domain/actor'
import { StatusNote } from '@/lib/types/domain/status'

import { Post } from './post'
import { currentTime, status } from './post.testUtils'

vi.mock('./collapsible-content', () => ({
  CollapsibleContent: ({
    children,
    onReadMore
  }: {
    children: ReactNode
    onReadMore?: () => void
  }) => (
    <div data-testid="collapsible-content">
      {children}
      {onReadMore && (
        <button
          type="button"
          data-testid="read-more-button"
          onClick={onReadMore}
        >
          Read full post
        </button>
      )}
    </div>
  )
}))

vi.mock('./poll', () => ({
  Poll: () => null
}))

vi.mock('./attachments', () => ({
  Attachments: () => null
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() })
}))

vi.mock('@/lib/client', () => ({
  bookmarkStatus: vi.fn(),
  undoBookmarkStatus: vi.fn(),
  deleteStatus: vi.fn(),
  likeStatus: vi.fn(),
  undoLikeStatus: vi.fn(),
  repostStatus: vi.fn(),
  undoRepostStatus: vi.fn(),
  updateStatusVisibility: vi.fn(),
  getRelationship: vi.fn().mockResolvedValue(null),
  mute: vi.fn(),
  unmute: vi.fn(),
  block: vi.fn(),
  unblock: vi.fn(),
  createReport: vi.fn(),
  retryFitnessProcessing: vi.fn(),
  getFitnessProcessingState: vi.fn().mockResolvedValue(null),
  getTranslationCapability: vi.fn(),
  getTranslationLanguages: vi.fn(),
  translateStatus: vi.fn(),
  reactToStatus: vi.fn(),
  unreactFromStatus: vi.fn(),
  getCustomEmojis: vi.fn().mockResolvedValue([]),
  // QuoteCard loads the quoted status itself; a quoting status renders it.
  getStatusById: vi.fn().mockResolvedValue(null)
}))

describe('Post', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const fitnessBase = {
    id: 'fitness-1',
    fileName: 'strava-123.tcx',
    fileType: 'tcx' as const,
    mimeType: 'application/vnd.garmin.tcx+xml',
    bytes: 1024,
    url: '/api/v1/fitness-files/fitness-1',
    processingStatus: 'completed' as const
  }

  describe('fitness source file', () => {
    // `fitnessFile.url` serves the ORIGINAL upload, which still holds the ends a
    // privacy location trims off the route map and the route data, so
    // `GET /api/v1/fitness-files/:id` is owner-only. The card's file NAME is its
    // label and stays for every viewer; only the download goes.
    const fitnessStatus = { ...status, summary: null, fitness: fitnessBase }

    it('links the file for its owner', () => {
      render(
        <Post
          host="activities.local"
          currentTime={currentTime}
          currentActor={status.actor ?? undefined}
          status={fitnessStatus}
          onShowAttachment={vi.fn()}
        />
      )

      expect(
        screen.getByRole('link', { name: 'strava-123.tcx' })
      ).toHaveAttribute('href', '/api/v1/fitness-files/fitness-1')
    })

    it.each([
      {
        description: 'withholds the download from a signed-in viewer',
        currentActor: {
          id: 'https://activities.local/users/someone-else',
          username: 'someone-else',
          domain: 'activities.local'
        } as unknown as ActorProfile
      },
      {
        description: 'withholds the download from a logged-out reader',
        currentActor: undefined
      }
    ])('$description', ({ currentActor }: { currentActor?: ActorProfile }) => {
      render(
        <Post
          host="activities.local"
          currentTime={currentTime}
          currentActor={currentActor}
          status={fitnessStatus}
          onShowAttachment={vi.fn()}
        />
      )

      expect(screen.getByText('strava-123.tcx')).toBeInTheDocument()
      expect(
        screen.queryByRole('link', { name: 'strava-123.tcx' })
      ).not.toBeInTheDocument()
    })
  })

  it('renders a "View on Strava" source link from the fitness source URL', () => {
    render(
      <Post
        host="activities.local"
        currentTime={currentTime}
        status={{
          ...status,
          summary: null,
          fitness: {
            ...fitnessBase,
            sourceUrl: 'https://www.strava.com/activities/123'
          }
        }}
        onShowAttachment={vi.fn()}
      />
    )

    const link = screen.getByRole('link', { name: /View on Strava/i })
    expect(link).toHaveAttribute(
      'href',
      'https://www.strava.com/activities/123'
    )
  })

  it('does not render a source link when the URL uses an unsafe scheme', () => {
    render(
      <Post
        host="activities.local"
        currentTime={currentTime}
        status={{
          ...status,
          summary: null,
          fitness: {
            ...fitnessBase,
            // eslint-disable-next-line no-script-url
            sourceUrl: 'javascript:alert(1)'
          }
        }}
        onShowAttachment={vi.fn()}
      />
    )

    expect(
      screen.queryByRole('link', { name: /View on Strava|View source/i })
    ).not.toBeInTheDocument()
  })

  it('shows the staged processing progress while a fresh fitness file is still processing', () => {
    render(
      <Post
        host="activities.local"
        currentTime={currentTime}
        currentActor={status.actor!}
        status={{
          ...status,
          summary: null,
          fitness: {
            ...fitnessBase,
            processingStatus: 'processing',
            processingStuck: false
          }
        }}
        onShowAttachment={vi.fn()}
      />
    )

    expect(screen.getByText(/Generating route map/i)).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Retry/i })
    ).not.toBeInTheDocument()
  })

  it('offers the owner a retry instead of an endless spinner once processing is stuck', () => {
    render(
      <Post
        host="activities.local"
        currentTime={currentTime}
        currentActor={status.actor!}
        status={{
          ...status,
          summary: null,
          fitness: {
            ...fitnessBase,
            processingStatus: 'processing',
            processingStuck: true
          }
        }}
        onShowAttachment={vi.fn()}
      />
    )

    expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument()
    expect(
      screen.queryByText(/Generating route map|Queued for processing/i)
    ).not.toBeInTheDocument()
  })

  describe('fitness route map failure', () => {
    // A missing route map is a degraded success: the activity parsed, the post
    // federated, the stats are real. It must not read as a failed post — the
    // whole reason the failure is recorded in `mapError` and not in
    // `processingStatus`.
    const mapFailedStatus = {
      ...status,
      summary: null,
      fitness: {
        ...fitnessBase,
        processingStatus: 'completed' as const,
        totalDistanceMeters: 11400,
        totalDurationSeconds: 9480,
        elevationGainMeters: 964,
        activityType: 'run',
        mapFailure: 'missing' as const
      }
    }

    it('offers the owner a retry that reads as a missing map, not a failed post', () => {
      render(
        <Post
          host="activities.local"
          currentTime={currentTime}
          currentActor={status.actor!}
          status={mapFailedStatus}
          onShowAttachment={vi.fn()}
        />
      )

      expect(
        screen.getByText(/route map image could not be generated/i)
      ).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument()
      expect(screen.queryByText(/Processing failed/i)).not.toBeInTheDocument()
    })

    it('keeps the stats the activity did produce', () => {
      render(
        <Post
          host="activities.local"
          currentTime={currentTime}
          currentActor={status.actor!}
          status={mapFailedStatus}
          onShowAttachment={vi.fn()}
        />
      )

      // Reusing `processingStatus: 'failed'` for this would hide all of these.
      expect(screen.getByText('Distance')).toBeInTheDocument()
      expect(screen.getByText('Duration')).toBeInTheDocument()
    })

    it('does not claim there is no map when the previous one is still shown', () => {
      render(
        <Post
          host="activities.local"
          currentTime={currentTime}
          currentActor={status.actor!}
          status={{
            ...mapFailedStatus,
            fitness: {
              ...mapFailedStatus.fitness,
              mapFailure: 'stale' as const
            }
          }}
          onShowAttachment={vi.fn()}
        />
      )

      // A failed REgeneration keeps the map it could not replace. Saying it
      // "could not be generated" would read as "you have no map" when the truth
      // is that the old one — possibly predating a privacy location the owner
      // just added — is still on the post.
      expect(
        screen.getByText(/could not be updated, so this is the previous one/i)
      ).toBeInTheDocument()
      expect(
        screen.queryByText(/could not be generated/i)
      ).not.toBeInTheDocument()
    })

    it('says nothing to a viewer who is not the owner', () => {
      render(
        <Post
          host="activities.local"
          currentTime={currentTime}
          status={mapFailedStatus}
          onShowAttachment={vi.fn()}
        />
      )

      // Someone else's missing image is not a reader's problem.
      expect(
        screen.queryByText(/route map image could not be generated/i)
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: /Retry/i })
      ).not.toBeInTheDocument()
      expect(screen.getByText('Distance')).toBeInTheDocument()
    })
  })

  it('renders the labeled stat grid, type pill, and device for a completed fitness file', () => {
    render(
      <Post
        host="activities.local"
        currentTime={currentTime}
        status={{
          ...status,
          summary: null,
          fitness: {
            ...fitnessBase,
            fileType: 'fit',
            fileName: '2025-05-27-skitour.fit',
            totalDistanceMeters: 11400,
            totalDurationSeconds: 9480,
            elevationGainMeters: 964,
            activityType: 'run',
            deviceManufacturer: 'garmin',
            deviceName: 'Fenix 7'
          }
        }}
        onShowAttachment={vi.fn()}
      />
    )

    // File name and lowercase type pill.
    expect(screen.getByText('2025-05-27-skitour.fit')).toBeInTheDocument()
    expect(screen.getByText('fit')).toBeInTheDocument()
    // Stats render as labeled cells (label and value are separate elements,
    // not the old "Distance: <value>" inline text).
    expect(screen.getByText('Distance')).toBeInTheDocument()
    expect(screen.getByText('11.4 km')).toBeInTheDocument()
    expect(screen.getByText('Duration')).toBeInTheDocument()
    expect(screen.getByText('2:38:00')).toBeInTheDocument()
    // A run activity surfaces Pace (not Avg speed) via getFitnessPaceOrSpeed.
    expect(screen.getByText('Pace')).toBeInTheDocument()
    expect(screen.getByText('Elevation')).toBeInTheDocument()
    expect(screen.getByText('964 m')).toBeInTheDocument()
    // Recording device footer links to the brand.
    expect(screen.getByRole('link', { name: 'Fenix 7' })).toBeInTheDocument()
    // Screen-reader label replaces the dropped visible "Fitness" text.
    expect(screen.getByText('Fitness activity')).toBeInTheDocument()
    // The old inline "Distance: <value>" treatment is gone.
    expect(screen.queryByText(/Distance:/)).not.toBeInTheDocument()
  })

  it('surfaces Avg speed (not Pace) for a cycling activity', () => {
    render(
      <Post
        host="activities.local"
        currentTime={currentTime}
        status={{
          ...status,
          summary: null,
          fitness: {
            ...fitnessBase,
            totalDistanceMeters: 26200,
            totalDurationSeconds: 3822,
            activityType: 'ride'
          }
        }}
        onShowAttachment={vi.fn()}
      />
    )

    expect(screen.getByText('Avg speed')).toBeInTheDocument()
    expect(screen.getByText('24.7 km/h')).toBeInTheDocument()
    expect(screen.queryByText('Pace')).not.toBeInTheDocument()
  })

  describe('fitness gear', () => {
    it('appends the gear name to the distance value', () => {
      render(
        <Post
          host="activities.local"
          currentTime={currentTime}
          status={{
            ...status,
            summary: null,
            fitness: {
              ...fitnessBase,
              totalDistanceMeters: 42600,
              totalDurationSeconds: 3822,
              activityType: 'ride',
              gearId: 'gear-1',
              gearName: 'Moots'
            }
          }}
          onShowAttachment={vi.fn()}
        />
      )

      // Gear rides along with the distance rather than adding a cell or a row.
      expect(screen.getByText('42.6 km · Moots')).toBeInTheDocument()
      expect(screen.queryByText('Gear')).not.toBeInTheDocument()
    })

    it.each([
      {
        description: 'no gear is attributed',
        gearId: null,
        gearName: null
      },
      {
        description: 'the gear name is blank',
        gearId: 'gear-1',
        gearName: '   '
      }
    ])(
      'leaves the distance untouched when $description',
      ({ gearId, gearName }) => {
        render(
          <Post
            host="activities.local"
            currentTime={currentTime}
            status={{
              ...status,
              summary: null,
              fitness: {
                ...fitnessBase,
                totalDistanceMeters: 42600,
                activityType: 'ride',
                gearId,
                gearName
              }
            }}
            onShowAttachment={vi.fn()}
          />
        )

        expect(screen.getByText('42.6 km')).toBeInTheDocument()
      }
    )

    it('keeps a long gear name whole in its text and title', () => {
      // fitness_gears.name is a varchar(255): the full name must stay in the
      // DOM (and in the title) however long it is.
      const longName = 'M'.repeat(200)
      render(
        <Post
          host="activities.local"
          currentTime={currentTime}
          status={{
            ...status,
            summary: null,
            fitness: {
              ...fitnessBase,
              totalDistanceMeters: 42600,
              activityType: 'ride',
              gearId: 'gear-1',
              gearName: longName
            }
          }}
          onShowAttachment={vi.fn()}
        />
      )

      const value = screen.getByText(`42.6 km · ${longName}`)
      expect(value).toHaveAttribute('title', `42.6 km · ${longName}`)
    })

    it('shows no gear when the activity has no distance to append it to', () => {
      render(
        <Post
          host="activities.local"
          currentTime={currentTime}
          status={{
            ...status,
            summary: null,
            fitness: {
              ...fitnessBase,
              totalDurationSeconds: 3822,
              gearId: 'gear-1',
              gearName: 'Moots'
            }
          }}
          onShowAttachment={vi.fn()}
        />
      )

      expect(screen.queryByText(/Moots/)).not.toBeInTheDocument()
      expect(screen.queryByText('Distance')).not.toBeInTheDocument()
    })
  })

  it('drops stat cells whose metric the file does not provide', () => {
    render(
      <Post
        host="activities.local"
        currentTime={currentTime}
        status={{
          ...status,
          summary: null,
          fitness: {
            ...fitnessBase,
            // Only distance is present: no duration/elevation, and pace/speed
            // needs both distance and duration, so those cells are dropped.
            totalDistanceMeters: 5000
          }
        }}
        onShowAttachment={vi.fn()}
      />
    )

    expect(screen.getByText('Distance')).toBeInTheDocument()
    expect(screen.getByText('5.00 km')).toBeInTheDocument()
    expect(screen.queryByText('Duration')).not.toBeInTheDocument()
    expect(screen.queryByText('Elevation')).not.toBeInTheDocument()
    expect(screen.queryByText('Pace')).not.toBeInTheDocument()
    expect(screen.queryByText('Avg speed')).not.toBeInTheDocument()
  })

  it('omits the stat grid entirely when no metrics are available but still shows the device', () => {
    render(
      <Post
        host="activities.local"
        currentTime={currentTime}
        status={{
          ...status,
          summary: null,
          fitness: {
            ...fitnessBase,
            // Completed, but nothing measurable parsed out of the file.
            deviceManufacturer: 'garmin',
            deviceName: 'Fenix 7'
          }
        }}
        onShowAttachment={vi.fn()}
      />
    )

    // No stat grid at all.
    expect(screen.queryByText('Distance')).not.toBeInTheDocument()
    expect(screen.queryByText('Duration')).not.toBeInTheDocument()
    expect(screen.queryByText('Elevation')).not.toBeInTheDocument()
    // The file row and the decoupled device footer still render.
    expect(screen.getByText('strava-123.tcx')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Fenix 7' })).toBeInTheDocument()
  })

  describe('the recording device', () => {
    const withDevice = (
      fitness: Partial<NonNullable<StatusNote['fitness']>> = {}
    ) => ({
      ...status,
      summary: null,
      fitness: {
        ...fitnessBase,
        deviceManufacturer: 'garmin',
        deviceName: 'Fenix 7',
        ...fitness
      }
    })

    it('links the owner to the device page', () => {
      render(
        <Post
          host="activities.local"
          currentTime={currentTime}
          currentActor={status.actor ?? undefined}
          status={withDevice({
            deviceGearId: 'device-1',
            deviceGearName: 'the Fenix'
          })}
          onShowAttachment={vi.fn()}
        />
      )

      // The row's editable name wins, and the link is same-origin.
      expect(screen.getByRole('link', { name: 'the Fenix' })).toHaveAttribute(
        'href',
        '/fitness/gear/device-1'
      )
    })

    it.each([
      {
        // The case that actually matters: a SIGNED-IN viewer looking at
        // someone else's ride. `/fitness/gear/<id>` is owner-scoped, so a link
        // there 404s for them.
        description: 'a signed-in viewer who is not the owner',
        currentActor: {
          id: 'https://activities.local/users/someone-else',
          username: 'someone-else',
          domain: 'activities.local'
        } as unknown as ActorProfile
      },
      {
        description: 'a logged-out reader',
        currentActor: undefined
      }
    ])(
      'keeps the manufacturer link for $description',
      ({ currentActor }: { currentActor?: ActorProfile }) => {
        render(
          <Post
            host="activities.local"
            currentTime={currentTime}
            currentActor={currentActor}
            status={withDevice({
              deviceGearId: 'device-1',
              deviceGearName: 'the Fenix'
            })}
            onShowAttachment={vi.fn()}
          />
        )

        expect(screen.getByRole('link', { name: 'the Fenix' })).toHaveAttribute(
          'href',
          'https://www.garmin.com'
        )
      }
    )

    it('renders the Via: line for a renamed device the brand map cannot resolve', () => {
      render(
        <Post
          host="activities.local"
          currentTime={currentTime}
          currentActor={status.actor ?? undefined}
          status={withDevice({
            deviceManufacturer: undefined,
            deviceName: undefined,
            deviceGearId: 'device-1',
            deviceGearName: 'My phone'
          })}
          onShowAttachment={vi.fn()}
        />
      )

      expect(screen.getByText('Via:')).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'My phone' })).toHaveAttribute(
        'href',
        '/fitness/gear/device-1'
      )
    })
  })
})
