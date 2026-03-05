import { api } from '@/lib/api-client'
import type { Pipeline, PipelineRun } from '@/types'

// --- Pipelines ---

export async function fetchPipelines(): Promise<Record<string, Pipeline>> {
  const response = await api<{ pipelines: Record<string, Pipeline> }>('GET', '/pipelines')
  return response.pipelines
}

export async function createPipeline(pipeline: Omit<Pipeline, 'id' | 'createdAt' | 'updatedAt'>): Promise<Pipeline> {
  const response = await api<{ pipeline: Pipeline }>('POST', '/pipelines', pipeline)
  return response.pipeline
}

export async function updatePipeline(id: string, pipeline: Omit<Pipeline, 'id' | 'createdAt' | 'updatedAt'>): Promise<Pipeline> {
  const response = await api<{ pipeline: Pipeline }>('PUT', `/pipelines/${id}`, pipeline)
  return response.pipeline
}

export async function deletePipeline(id: string): Promise<void> {
  await api('DELETE', `/pipelines/${id}`)
}

export async function getPipeline(id: string): Promise<Pipeline> {
  const response = await api<{ pipeline: Pipeline }>('GET', `/pipelines/${id}`)
  return response.pipeline
}

// --- Pipeline Runs ---

export async function fetchPipelineRuns(pipelineId?: string): Promise<PipelineRun[]> {
  const url = pipelineId ? `/pipeline-runs?pipelineId=${pipelineId}` : '/pipeline-runs'
  const response = await api<{ runs: PipelineRun[] }>('GET', url)
  return response.runs
}

export async function startPipelineRun(id: string, projectId?: string): Promise<PipelineRun> {
  const response = await api<{ run: PipelineRun }>('POST', `/pipelines/${id}/run`, { projectId })
  return response.run
}

export async function getPipelineRun(id: string): Promise<PipelineRun> {
  const response = await api<{ run: PipelineRun }>('GET', `/pipeline-runs/${id}`)
  return response.run
}

export async function intervenePipelineRun(id: string, action: 'retry' | 'skip'): Promise<PipelineRun> {
  const response = await api<{ run: PipelineRun }>('POST', `/pipeline-runs/${id}/intervene`, { action })
  return response.run
}

export async function cancelPipelineRun(pipelineId: string, runId: string): Promise<void> {
  await api('POST', `/pipelines/${pipelineId}/runs/${runId}/cancel`)
}

export async function deleteRun(id: string): Promise<void> {
  await api('DELETE', `/pipeline-runs/${id}`)
}

export async function nudgeTask(runId: string, stageId: string, taskId: string, type: 'interrupt' | 'check'): Promise<void> {
  await api('POST', `/pipeline-runs/${runId}/stages/${stageId}/nudge`, { taskId, type })
}
