import { NextRequest, NextResponse } from 'next/server'
import { loadPipelines, upsertPipeline, deletePipeline } from '@/lib/server/storage'
import { notify } from '@/lib/server/ws-hub'
import { genId } from '@/lib/id'
import type { Pipeline } from '@/types'

export async function GET(
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

    return NextResponse.json({ pipeline })
  } catch (error) {
    console.error('[pipelines] GET error:', error)
    return NextResponse.json({ error: 'Failed to load pipeline' }, { status: 500 })
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const pipelines = loadPipelines()
    const existing = pipelines[id] as Pipeline | undefined

    if (!existing) {
      return NextResponse.json({ error: 'Pipeline not found' }, { status: 404 })
    }

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

    const pipeline: Pipeline = {
      ...existing,
      name: name.trim(),
      description: description?.trim() || '',
      projectId: projectId || null,
      stages: stages.map((stage: any, index: number) => ({
        ...stage,
        id: stage.id || existing.stages[index]?.id || genId(),
        order: index,
        tasks: stage.tasks.map((task: any, taskIndex: number) => ({
          ...task,
          id: task.id || existing.stages[index]?.tasks[taskIndex]?.id || genId(),
          order: taskIndex
        }))
      })),
      failurePolicy,
      notifySettings,
      updatedAt: Date.now()
    }

    upsertPipeline(id, pipeline)
    notify('pipelines')

    return NextResponse.json({ pipeline })
  } catch (error) {
    console.error('[pipelines] PUT error:', error)
    return NextResponse.json({ error: 'Failed to update pipeline' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const pipelines = loadPipelines()
    const existing = pipelines[id]

    if (!existing) {
      return NextResponse.json({ error: 'Pipeline not found' }, { status: 404 })
    }

    deletePipeline(id)
    notify('pipelines')

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[pipelines] DELETE error:', error)
    return NextResponse.json({ error: 'Failed to delete pipeline' }, { status: 500 })
  }
}
