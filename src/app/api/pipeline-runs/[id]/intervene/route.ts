import { NextRequest, NextResponse } from 'next/server'
import { loadPipelineRuns, upsertPipelineRun } from '@/lib/server/storage'
import { notify } from '@/lib/server/ws-hub'
import type { PipelineRun } from '@/types'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const runs = loadPipelineRuns()
    const run = runs[id] as PipelineRun | undefined

    if (!run) {
      return NextResponse.json({ error: 'Pipeline run not found' }, { status: 404 })
    }

    if (run.status !== 'paused') {
      return NextResponse.json({ error: 'Pipeline run is not paused' }, { status: 400 })
    }

    const body = await request.json()
    const { action } = body

    if (!['retry', 'skip'].includes(action)) {
      return NextResponse.json({ error: 'Invalid action. Must be "retry" or "skip"' }, { status: 400 })
    }

    if (!run.pausedAt) {
      return NextResponse.json({ error: 'No paused task found' }, { status: 400 })
    }

    // Find the paused task and update it
    const { stageId, taskId } = run.pausedAt
    const runStage = run.stages.find(s => s.stageId === stageId)
    const runTask = runStage?.tasks.find(t => t.taskId === taskId)

    if (!runTask) {
      return NextResponse.json({ error: 'Paused task not found' }, { status: 404 })
    }

    // Update the task based on action
    if (action === 'retry') {
      runTask.status = 'pending'
      runTask.error = null
      runTask.startedAt = null
      runTask.completedAt = null
    } else if (action === 'skip') {
      runTask.status = 'skipped'
      runTask.completedAt = Date.now()
    }

    // Clear the paused state and resume the run
    run.status = 'running'
    run.pausedAt = null
    run.updatedAt = Date.now()

    upsertPipelineRun(id, run)
    notify('pipeline-runs')

    // TODO: Resume pipeline execution engine (will implement later)

    return NextResponse.json({ run })
  } catch (error) {
    console.error('[pipeline-runs] POST intervene error:', error)
    return NextResponse.json({ error: 'Failed to intervene in pipeline run' }, { status: 500 })
  }
}
