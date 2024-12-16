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
  const INVISIBLE_MARKER =
    inputs.commentTag || `<!-- CTRF PR COMMENT TAG: ${context.workflow} -->`
  generateViews(inputs, report)

  if (shouldAddCommentToPullRequest(inputs, report)) {
    let newSummary = core.summary.stringify()

    if (!newSummary.includes(INVISIBLE_MARKER)) {
      core.summary.addRaw(INVISIBLE_MARKER)
      newSummary = core.summary.stringify()
    }

    const owner = context.repo.owner
    const repo = context.repo.repo
    const issue_number = context.issue.number

    const existingComment = await findExistingMarkedComment(
      owner,
      repo,
      issue_number,
      INVISIBLE_MARKER
    )

    let finalBody = newSummary

    if (existingComment) {
      if (inputs.updateComment && !inputs.overwriteComment) {
        finalBody = `${existingComment.body}\n\n---\n\n${newSummary}`
      } else if (inputs.overwriteComment) {
        finalBody = newSummary
      }
    }

    if (existingComment && (inputs.updateComment || inputs.overwriteComment)) {
      await updateComment(
        existingComment.id,
        owner,
        repo,
        issue_number,
        finalBody
      )
    } else {
      await addCommentToPullRequest(owner, repo, issue_number, finalBody)
    }
  }

  if (inputs.summary && !inputs.pullRequestReport) {
    await core.summary.write()
  }
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
