import { NextRequest, NextResponse } from 'next/server'
import { loadPipelineRuns, upsertPipelineRun, deletePipelineRun } from '@/lib/server/storage'
import { notify } from '@/lib/server/ws-hub'
import { deletePipelineRunWorkspace } from '@/lib/server/pipeline-executor'
import type { PipelineRun } from '@/types'

export async function GET(
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

    return NextResponse.json({ run })
  } catch (error) {
    console.error('[pipeline-runs] GET error:', error)
    return NextResponse.json({ error: 'Failed to load pipeline run' }, { status: 500 })
  }
}

export async function DELETE(
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

    deletePipelineRun(id)
    notify('pipeline-runs')

    // Delete workspace directory using stored path (safety-checked inside deletePipelineRunWorkspace)
    if (run.workspaceDir) {
      deletePipelineRunWorkspace(run.workspaceDir)
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[pipeline-runs] DELETE error:', error)
    return NextResponse.json({ error: 'Failed to delete pipeline run' }, { status: 500 })
  }
}
