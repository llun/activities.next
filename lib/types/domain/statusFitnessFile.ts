import { z } from 'zod'

export const StatusFitnessFile = z.object({
  id: z.string(),
  fileName: z.string(),
  fileType: z.enum(['fit', 'gpx', 'tcx']),
  mimeType: z.string(),
  bytes: z.number(),
  url: z.string(),
  description: z.string().optional(),
  processingStatus: z
    .enum(['pending', 'processing', 'completed', 'failed'])
    .optional(),
  // True when a `processing` file has been stranded long enough that its worker
  // must have died mid-job; signals clients to offer a retry. Computed
  // server-side from the file's `updatedAt`.
  processingStuck: z.boolean().optional(),
  // What is wrong with the route map, when something is. A closed vocabulary,
  // never the reason: this payload is served to every viewer of the status, and
  // the reason is a raw error string that can name internal infrastructure —
  // the owner reads that on their own fitness files page. `missing`: none could
  // be produced. `stale`: the previous one is still shown, because the run that
  // should have replaced it failed.
  mapFailure: z.enum(['missing', 'stale']).optional(),
  totalDistanceMeters: z.number().optional(),
  totalDurationSeconds: z.number().optional(),
  movingTimeSeconds: z.number().optional(),
  elevationGainMeters: z.number().optional(),
  activityType: z.string().optional(),
  // When the activity itself was recorded. Carried here because the post's own
  // `createdAt` is NOT a stand-in for it: a Strava webhook import is stamped
  // when it published rather than when the ride began (see `postAtImportTime`
  // in `lib/jobs/importFitnessFilesJob.ts`), so a surface that fell back to the
  // post time would render the wrong activity date. Already public at this
  // visibility — `/api/v1/fitness-files/by-status` serves it to every viewer
  // who can see the status.
  activityStartTime: z.number().optional(),
  hasMapData: z.boolean().optional(),
  deviceName: z.string().optional(),
  deviceManufacturer: z.string().optional(),
  sourceUrl: z.string().optional(),
  // The gear this activity is attributed to. The name is deliberately public —
  // the timeline chip renders it to every viewer, the same way the device name
  // is. Nothing else about the gear (default sports, service thresholds, notes)
  // belongs in a status payload.
  gearId: z.string().nullable().optional(),
  gearName: z.string().nullable().optional(),
  // The recording device, on the same terms: the name is already public as
  // `deviceName`, and the id is what lets the owner's own view link the label to
  // the device page. A viewer who is not the owner gets no page to open, so the
  // id is inert for them.
  deviceGearId: z.string().nullable().optional(),
  deviceGearName: z.string().nullable().optional(),
  avgPower: z.number().nullable().optional(),
  maxPower: z.number().nullable().optional(),
  avgHeartRate: z.number().nullable().optional(),
  maxHeartRate: z.number().nullable().optional(),
  totalWorkKj: z.number().nullable().optional(),
  elevationSeries: z.array(z.number()).nullable().optional()
})
export type StatusFitnessFile = z.infer<typeof StatusFitnessFile>
