import { NextRequest, NextResponse } from 'next/server'
import { loadPipelineRuns, upsertPipelineRun } from '@/lib/server/storage'
import { notify } from '@/lib/server/ws-hub'
import { genId } from '@/lib/id'
import type { PipelineRun } from '@/types'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const pipelineId = searchParams.get('pipelineId')

    const runs = loadPipelineRuns()
    let filteredRuns = Object.values(runs) as PipelineRun[]

    if (pipelineId) {
      filteredRuns = filteredRuns.filter(run => run.pipelineId === pipelineId)
    }

    // Sort by creation date (newest first)
    filteredRuns.sort((a, b) => b.createdAt - a.createdAt)

    return NextResponse.json({ runs: filteredRuns })
  } catch (error) {
    console.error('[pipeline-runs] GET error:', error)
    return NextResponse.json({ error: 'Failed to load pipeline runs' }, { status: 500 })
  }
}
