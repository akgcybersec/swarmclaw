import { NextRequest, NextResponse } from 'next/server'
import { loadPipelines, upsertPipeline, deletePipeline } from '@/lib/server/storage'
import { notify } from '@/lib/server/ws-hub'
import { genId } from '@/lib/id'
import type { Pipeline } from '@/types'

export async function GET() {
  try {
    const pipelines = loadPipelines()
    return NextResponse.json({ pipelines })
  } catch (error) {
    console.error('[pipelines] GET error:', error)
    return NextResponse.json({ error: 'Failed to load pipelines' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { name, description, projectId, stages, failurePolicy, notifySettings } = body

    // Basic validation
    if (!name?.trim()) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 })
    }

    if (!stages?.length) {
      return NextResponse.json({ error: 'At least one stage is required' }, { status: 400 })
    }

    // Validate stages
    for (const stage of stages) {
      if (!stage.label?.trim()) {
        return NextResponse.json({ error: 'Each stage must have a label' }, { status: 400 })
      }
      if (!stage.agentId?.trim()) {
        return NextResponse.json({ error: 'Each stage must have an agent' }, { status: 400 })
      }
      if (!stage.tasks?.length) {
        return NextResponse.json({ error: 'Each stage must have at least one task' }, { status: 400 })
      }
      for (const task of stage.tasks) {
        if (!task.label?.trim()) {
          return NextResponse.json({ error: 'Each task must have a label' }, { status: 400 })
        }
        if (!task.prompt?.trim()) {
          return NextResponse.json({ error: 'Each task must have a prompt' }, { status: 400 })
        }
      }
    }

    // Validate failure policy
    if (!['continue', 'pause', 'abort'].includes(failurePolicy)) {
      return NextResponse.json({ error: 'Invalid failure policy' }, { status: 400 })
    }

    // Validate notify settings
    if (!notifySettings || typeof notifySettings !== 'object') {
      return NextResponse.json({ error: 'Notification settings are required' }, { status: 400 })
    }

    const id = genId()
    const now = Date.now()

    const pipeline: Pipeline = {
      id,
      name: name.trim(),
      description: description?.trim() || '',
      projectId: projectId || null,
      stages: stages.map((stage: any, index: number) => ({
        ...stage,
        id: genId(), // Always generate a new ID for consistency
        order: index,
        useAssetsFrom: Array.isArray(stage.useAssetsFrom) ? stage.useAssetsFrom : [],
        tasks: stage.tasks.map((task: any, taskIndex: number) => ({
          ...task,
          id: genId(), // Always generate a new ID for consistency
          order: taskIndex
        }))
      })),
      failurePolicy,
      notifySettings,
      createdAt: now,
      updatedAt: now
    }

    upsertPipeline(id, pipeline)
    notify('pipelines')

    return NextResponse.json({ pipeline })
  } catch (error) {
    console.error('[pipelines] POST error:', error)
    return NextResponse.json({ error: 'Failed to create pipeline' }, { status: 500 })
  }
}
