import { NextRequest, NextResponse } from 'next/server'
import { loadPipelineRuns, upsertPipelineRun } from '@/lib/server/storage'
import type { PipelineRun } from '@/types'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const runs = loadPipelineRuns()
    const run = runs[params.id] as PipelineRun | undefined

    if (!run) {
      return NextResponse.json({ error: 'Pipeline run not found' }, { status: 404 })
    }

    return NextResponse.json({ run })
  } catch (error) {
    console.error('[pipeline-runs] GET error:', error)
    return NextResponse.json({ error: 'Failed to load pipeline run' }, { status: 500 })
  }
}
