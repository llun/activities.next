// Parameter and result types of the report domain (user reports reviewed
// through the admin moderation API). lib/types/database/operations.ts
// re-exports them, so existing imports keep working.
import { z } from 'zod'

export const ReportCategory = z.enum(['spam', 'legal', 'violation', 'other'])
export type ReportCategory = z.infer<typeof ReportCategory>

export type Report = {
  id: string
  actorId: string
  targetActorId: string
  category: ReportCategory
  comment: string
  forward: boolean
  statusIds: string[]
  ruleIds: string[]
  collectionIds: string[]
  actionTaken: boolean
  // Workflow columns (Admin moderation API). Actor ids in URL form.
  assignedActorId: string | null
  actionTakenAt: number | null
  actionTakenByActorId: string | null
  createdAt: number
  updatedAt: number
}
export type CreateReportParams = {
  actorId: string
  targetActorId: string
  category?: ReportCategory
  comment?: string
  forward?: boolean
  statusIds?: string[]
  ruleIds?: string[]
  collectionIds?: string[]
}

export type GetAdminReportsParams = {
  // `resolved` maps to the action_taken flag.
  resolved?: boolean
  // Reporter / target actor ids in URL form.
  accountId?: string
  targetActorId?: string
  byTargetDomain?: string
  limit?: number
  maxId?: string | null
  minId?: string | null
  sinceId?: string | null
}
export type GetReportByIdParams = { reportId: string }
export type UpdateReportCategoryParams = {
  reportId: string
  category?: ReportCategory
  ruleIds?: string[]
}
export type AssignReportParams = {
  reportId: string
  // null unassigns.
  assignedActorId: string | null
}

export interface ReportDatabase {
  createReport(params: CreateReportParams): Promise<Report>
  // Filter/keyset-paginated admin report listing (newest first).
  getAdminReports(params: GetAdminReportsParams): Promise<Report[]>
  getReportById(params: GetReportByIdParams): Promise<Report | null>
  // Update the report category and/or rule ids; returns the updated report.
  updateReportCategory(
    params: UpdateReportCategoryParams
  ): Promise<Report | null>
  // Assign (or, with null, unassign) the report to a moderator actor.
  assignReport(params: AssignReportParams): Promise<Report | null>
}
