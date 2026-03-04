import { NextRequest, NextResponse } from 'next/server'
import { loadPipelineRuns, upsertPipelineRun, loadTasks, upsertTask } from '@/lib/server/storage'
import { notify } from '@/lib/server/ws-hub'
import type { PipelineRun, BoardTask } from '@/types'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; runId: string }> }
) {
  try {
    const { runId } = await params
    const runs = loadPipelineRuns()
    const run = runs[runId] as PipelineRun | undefined

    if (!run) {
      return NextResponse.json({ error: 'Pipeline run not found' }, { status: 404 })
    }

    if (run.status !== 'running' && run.status !== 'pending') {
      return NextResponse.json({ error: 'Pipeline run is not active' }, { status: 400 })
    }

    // Mark run as cancelled
    run.status = 'cancelled'
    run.updatedAt = Date.now()
    run.completedAt = Date.now()
    upsertPipelineRun(runId, run)
    notify('pipeline-runs')

    // Cancel all running BoardTasks and update pipeline run task statuses
    const tasks = loadTasks()
    let cancelledCount = 0
    const now = Date.now()

    for (const stage of run.stages) {
      for (const task of stage.tasks) {
        // Update pipeline run task status
        if (task.status === 'running' || task.status === 'pending') {
          task.status = 'failed'
          task.error = 'Pipeline run cancelled by user'
          task.completedAt = now
        }

        // Cancel associated BoardTask
        const boardTaskId = (task as any).boardTaskId
        if (!boardTaskId) continue

        const boardTask = tasks[boardTaskId] as BoardTask | undefined
        if (boardTask && boardTask.status === 'running') {
          boardTask.status = 'failed'
          boardTask.error = 'Pipeline run cancelled by user'
          boardTask.updatedAt = now
          boardTask.completedAt = now
          upsertTask(boardTaskId, boardTask)
          cancelledCount++
        }
      }
      
      // Update stage status if it was running
      if (stage.status === 'running') {
        stage.status = 'failed'
        stage.completedAt = now
      }
    }

    if (cancelledCount > 0) {
      notify('tasks')
    }

    return NextResponse.json({ 
      success: true, 
      run,
      cancelledTasks: cancelledCount
    })
  } catch (error) {
    console.error('[pipelines] POST cancel error:', error)
    return NextResponse.json({ error: 'Failed to cancel pipeline run' }, { status: 500 })
  }
}
