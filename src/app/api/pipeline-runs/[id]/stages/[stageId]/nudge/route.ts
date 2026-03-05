import { NextRequest, NextResponse } from 'next/server'
import { loadPipelineRuns } from '@/lib/server/storage'
import type { PipelineRun, PipelineRunStage } from '@/types'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; stageId: string }> }
) {
  try {
    const { id: runId, stageId } = await params
    const body = await request.json()
    const { taskId, type } = body as { taskId: string; type: 'interrupt' | 'check' }

    if (!taskId || !type) {
      return NextResponse.json({ error: 'taskId and type are required' }, { status: 400 })
    }

    const runs = loadPipelineRuns()
    const run = runs[runId] as PipelineRun | undefined
    if (!run) {
      return NextResponse.json({ error: 'Pipeline run not found' }, { status: 404 })
    }

    const stage = run.stages.find((s: PipelineRunStage) => s.stageId === stageId)
    if (!stage) {
      return NextResponse.json({ error: 'Stage not found' }, { status: 404 })
    }

    const sessionId = (stage as any).sessionId as string | undefined
    if (!sessionId) {
      return NextResponse.json({ error: 'No active session for this stage' }, { status: 400 })
    }

    const { enqueueSessionRun } = await import('@/lib/server/session-run-manager')

    const message = type === 'interrupt'
      ? `STOP all tool calls immediately. Call manage_tasks right now: manage_tasks({ action: "update", id: "${taskId}", data: { status: "completed", result: "<brief summary of what you did>" } }). Do not run any more tools.`
      : `Please give a brief status update: what have you completed so far on task ${taskId}, and what are you currently doing?`

    enqueueSessionRun({
      sessionId,
      message,
      source: 'pipeline',
      internal: type === 'interrupt',
      mode: 'steer',
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[pipeline nudge] POST error:', error)
    return NextResponse.json({ error: 'Failed to send nudge' }, { status: 500 })
  }
}
