import { NextRequest, NextResponse } from 'next/server'
import { loadPipelines, loadPipelineRuns, upsertPipelineRun } from '@/lib/server/storage'
import { notify } from '@/lib/server/ws-hub'
import { genId } from '@/lib/id'
import type { Pipeline, PipelineRun } from '@/types'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const pipelines = loadPipelines()
    const pipeline = pipelines[id] as Pipeline | undefined

    if (!pipeline) {
      return NextResponse.json({ error: 'Pipeline not found' }, { status: 404 })
    }

    const body = await request.json()
    const { projectId } = body

    // Create pipeline run
    const runId = genId()
    const now = Date.now()

    const run: PipelineRun = {
      id: runId,
      pipelineId: id,
      projectId: projectId || pipeline.projectId || null,
      status: 'pending',
      stages: pipeline.stages.map(stage => ({
        stageId: stage.id,
        status: 'pending',
        sessionId: null,
        tasks: stage.tasks.map(task => ({
          taskId: task.id,
          status: 'pending',
          result: null,
          error: null,
          artifacts: [],
          startedAt: null,
          completedAt: null
        }))
      })),
      createdAt: now,
      updatedAt: now
    }

    upsertPipelineRun(runId, run)
    notify('pipeline-runs')

    // Fire execution asynchronously — do not await so we return immediately
    // Use Promise without await to start execution in background
    const { executePipelineRun } = await import('@/lib/server/pipeline-executor')
    executePipelineRun(runId).catch(err => {
      console.error('[pipeline-run] executor error:', err)
    })

    return NextResponse.json({ run })
  } catch (error) {
    console.error('[pipelines] POST run error:', error)
    return NextResponse.json({ error: 'Failed to start pipeline run' }, { status: 500 })
  }
}
