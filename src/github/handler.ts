import * as core from '@actions/core'
import { context } from '@actions/github'
import {
  addCommentToPullRequest,
  updateComment,
  listComments
} from '../client/github'
import { CtrfReport, Inputs } from '../types'
import { generateViews, annotateFailed } from './core'
import { components } from '@octokit/openapi-types'

type IssueComment = components['schemas']['issue-comment']
const INVISIBLE_MARKER = `<!-- CTRF PR COMMENT TAG: ${context.job} -->`

/**
 * Handles the generation of views and comments for a CTRF report.
 *
 * - Generates various views of the CTRF report and adds them to the GitHub Actions summary.
 * - Adds a comment to the pull request if the conditions are met.
 * - Writes the summary to the GitHub Actions output if requested.
 *
 * @param inputs - The user-provided inputs for configuring views and comments.
 * @param report - The CTRF report containing test results.
 * @returns A promise that resolves when the operations are completed.
 */
export async function handleViewsAndComments(
  inputs: Inputs,
  report: CtrfReport
): Promise<void> {
  // Generate the report views for summary
  generateViews(inputs, report)

  // Determine if we should comment on the PR
  if (shouldAddCommentToPullRequest(inputs, report)) {
    // Add our invisible marker to the summary so we can find this comment later
    core.summary.addRaw(INVISIBLE_MARKER)

    const owner = context.repo.owner
    const repo = context.repo.repo
    const issue_number = context.issue.number

    // Fetch existing PR comments to see if we already posted one with our marker
    const existingComment = await findExistingMarkedComment(
      owner,
      repo,
      issue_number,
      INVISIBLE_MARKER
    )

    const body = core.summary.stringify()

    if (existingComment && (inputs.updateComment || inputs.overwriteComment)) {
      // Update/overwrite the existing comment
      // Overwrite vs update logic can differ; for simplicity, we just replace the entire body.
      await updateComment(existingComment.id, owner, repo, issue_number, body)
    } else {
      // If no existing comment or no update requested, just add a new comment
      await addCommentToPullRequest(owner, repo, issue_number, body)
    }
  }

  if (inputs.summary && !inputs.pullRequestReport) {
    await core.summary.write()
  }
}

export function updateCommentInPr(): void {
  // This function could hold additional logic if needed,
  // but for now we've included everything in handleViewsAndComments.
}

/**
 * Determines if a comment should be added to the pull request based on inputs and report data.
 *
 * @param inputs - The user-provided inputs for configuring pull request comments.
 * @param report - The CTRF report containing test results.
 * @returns `true` if a comment should be added, otherwise `false`.
 */
export function shouldAddCommentToPullRequest(
  inputs: Inputs,
  report: CtrfReport
): boolean {
  const shouldAddComment =
    (inputs.onFailOnly && report.results.summary.failed > 0) ||
    !inputs.onFailOnly

  return (
    (inputs.pullRequestReport || inputs.pullRequest) &&
    context.eventName === 'pull_request' &&
    shouldAddComment
  )
}

/**
 * Handles the annotation of failed tests in the CTRF report.
 *
 * - Annotates all failed tests in the GitHub Actions log if annotation is enabled in inputs.
 *
 * @param inputs - The user-provided inputs for configuring annotations.
 * @param report - The CTRF report containing test results.
 */
export function handleAnnotations(inputs: Inputs, report: CtrfReport): void {
  if (inputs.annotate) {
    annotateFailed(report)
  }
}

/**
 * Searches for an existing PR comment containing a given marker.
 *
 * @param owner
 * @param repo
 * @param issue_number
 * @param marker
 * @returns The comment object if found, otherwise undefined.
 */
async function findExistingMarkedComment(
  owner: string,
  repo: string,
  issue_number: number,
  marker: string
): Promise<IssueComment | undefined> {
  const comments = await listComments(owner, repo, issue_number)
  return comments.find(comment => comment.body && comment.body.includes(marker))
}
