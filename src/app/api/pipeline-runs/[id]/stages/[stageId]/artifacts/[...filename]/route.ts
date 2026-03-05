import fs from 'fs'
import path from 'path'
import { NextRequest, NextResponse } from 'next/server'
import { loadPipelineRuns } from '@/lib/server/storage'
import type { PipelineRun, PipelineRunStage } from '@/types'

const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'json', 'yaml', 'yml', 'csv', 'log', 'sh', 'py', 'js', 'ts',
  'tsx', 'jsx', 'html', 'css', 'xml', 'toml', 'ini', 'env', 'sql', 'rs',
  'go', 'rb', 'php', 'java', 'c', 'cpp', 'h', 'conf', 'nmap', 'out',
])

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico'])

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; stageId: string; filename: string[] }> }
) {
  try {
    const { id: runId, stageId, filename } = await params
    const safeFilename = filename.join('/')

    // Prevent path traversal
    if (safeFilename.includes('..')) {
      return NextResponse.json({ error: 'Invalid filename' }, { status: 400 })
    }

    const runs = loadPipelineRuns()
    const run = runs[runId] as PipelineRun | undefined
    if (!run) return NextResponse.json({ error: 'Pipeline run not found' }, { status: 404 })

    const stageRecord = run.stages.find((s: PipelineRunStage) => s.stageId === stageId)
    const stageDir = stageRecord?.workspaceDir
    if (!stageDir) return NextResponse.json({ error: 'Stage workspace not found' }, { status: 404 })
    const filePath = path.join(stageDir, safeFilename)

    // Safety check: ensure file is inside stage directory
    const resolvedFile = path.resolve(filePath)
    const resolvedDir = path.resolve(stageDir)
    if (!resolvedFile.startsWith(resolvedDir + path.sep)) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }

    const stat = fs.statSync(filePath)
    if (!stat.isFile()) {
      return NextResponse.json({ error: 'Not a file' }, { status: 400 })
    }

    const ext = path.extname(safeFilename).toLowerCase().slice(1)
    const searchParams = new URL(request.url).searchParams
    const download = searchParams.get('download') === '1'

    if (download) {
      const buffer = fs.readFileSync(filePath)
      return new NextResponse(buffer, {
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': `attachment; filename="${path.basename(safeFilename)}"`,
        },
      })
    }

    if (IMAGE_EXTENSIONS.has(ext)) {
      const buffer = fs.readFileSync(filePath)
      const mimeMap: Record<string, string> = {
        png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
        gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', ico: 'image/x-icon',
      }
      return new NextResponse(buffer, {
        headers: { 'Content-Type': mimeMap[ext] ?? 'image/png' },
      })
    }

    if (TEXT_EXTENSIONS.has(ext)) {
      const content = fs.readFileSync(filePath, 'utf-8')
      return NextResponse.json({ content, ext, size: stat.size })
    }

    // Binary fallback — return size/type info only
    return NextResponse.json({ content: null, ext, size: stat.size, binary: true })
  } catch (error) {
    console.error('[pipeline-runs] artifact file GET error:', error)
    return NextResponse.json({ error: 'Failed to read file' }, { status: 500 })
  }
}
