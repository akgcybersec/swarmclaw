import fs from 'fs'
import path from 'path'
import { NextRequest, NextResponse } from 'next/server'
import { loadPipelineRuns } from '@/lib/server/storage'
import type { PipelineRun, PipelineRunStage } from '@/types'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; stageId: string }> }
) {
  try {
    const { id: runId, stageId } = await params

    const runs = loadPipelineRuns()
    const run = runs[runId] as PipelineRun | undefined
    if (!run) {
      return NextResponse.json({ error: 'Pipeline run not found' }, { status: 404 })
    }

    const stage = run.stages.find((s: PipelineRunStage) => s.stageId === stageId)
    const stageDir = stage?.workspaceDir ?? null
    if (!stageDir) {
      return NextResponse.json({ files: [] })
    }

    if (!fs.existsSync(stageDir)) {
      return NextResponse.json({ files: [] })
    }

    const entries = fs.readdirSync(stageDir, { withFileTypes: true })
    const files = entries
      .filter(e => e.isFile())
      .map(e => {
        const absPath = path.join(stageDir, e.name)
        const stat = fs.statSync(absPath)
        const ext = path.extname(e.name).toLowerCase().slice(1)
        return {
          name: e.name,
          size: stat.size,
          mtimeMs: stat.mtimeMs,
          ext,
        }
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs)

    return NextResponse.json({ files, stageDir })
  } catch (error) {
    console.error('[pipeline-runs] artifacts GET error:', error)
    return NextResponse.json({ error: 'Failed to list artifacts' }, { status: 500 })
  }
}
