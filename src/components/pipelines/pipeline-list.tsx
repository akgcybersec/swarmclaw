'use client'

import { useEffect, useCallback, useState } from 'react'
import { useAppStore } from '@/stores/use-app-store'
import { useWs } from '@/hooks/use-ws'
import { createPipeline } from '@/lib/pipelines'
import type { Pipeline } from '@/types'

function relativeDate(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

interface PipelineListProps {
  selectedId: string | null
  onSelect: (id: string) => void
}

export function PipelineList({ selectedId, onSelect }: PipelineListProps) {
  const pipelines = useAppStore((s) => s.pipelines)
  const pipelineRuns = useAppStore((s) => s.pipelineRuns)
  const loadPipelines = useAppStore((s) => s.loadPipelines)
  const loadPipelineRuns = useAppStore((s) => s.loadPipelineRuns)
  const agents = useAppStore((s) => s.agents)
  const [creating, setCreating] = useState(false)

  const refresh = useCallback(() => {
    loadPipelines()
    loadPipelineRuns()
  }, [loadPipelines, loadPipelineRuns])

  useEffect(() => { refresh() }, [refresh])
  useWs('pipelines', refresh, 15_000)
  useWs('pipeline-runs', refresh, 5_000)

  const handleCreate = async () => {
    if (creating) return
    setCreating(true)
    const count = Object.keys(pipelines).length + 1
    const newPipeline: Omit<Pipeline, 'id' | 'createdAt' | 'updatedAt'> = {
      name: `Pipeline ${count}`,
      description: '',
      stages: [{
        id: `stage-${Date.now()}`,
        agentId: Object.keys(agents)[0] || '',
        label: 'Stage 1',
        tasks: [{ id: `task-${Date.now()}`, label: 'Task 1', prompt: 'Enter task instructions here', order: 1 }],
        dependsOn: [],
        order: 1
      }],
      failurePolicy: 'pause',
      notifySettings: { onTaskComplete: true, onStageComplete: true, onRunComplete: true, onFailure: true, channels: ['app'] },
      projectId: null
    }
    try {
      const created = await createPipeline(newPipeline)
      await loadPipelines()
      onSelect(created.id)
    } catch (err) {
      console.error('[pipelines] create error:', err)
    } finally {
      setCreating(false)
    }
  }

  const sorted = Object.values(pipelines).sort((a: Pipeline, b: Pipeline) => b.updatedAt - a.updatedAt)

  const getLastRunStatus = (pipelineId: string) => {
    const runs = Object.values(pipelineRuns)
      .filter((r) => r.pipelineId === pipelineId)
      .sort((a, b) => b.createdAt - a.createdAt)
    return runs[0]?.status ?? null
  }

  return (
    <>
      <div className="flex items-center px-4 pt-4 pb-2 shrink-0">
        <h2 className="font-display text-[14px] font-600 text-text-2 tracking-[-0.01em] flex-1">Pipelines</h2>
        <button
          onClick={handleCreate}
          disabled={creating}
          className="flex items-center gap-1 px-2 py-1 rounded-[6px] text-[11px] font-600 text-accent-bright bg-accent-soft hover:bg-accent-bright/15 transition-all cursor-pointer disabled:opacity-50"
          style={{ fontFamily: 'inherit' }}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          New
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full py-12 text-center px-4">
            <div className="w-10 h-10 rounded-[12px] bg-accent-soft/30 flex items-center justify-center mb-3">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-accent-bright">
                <path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5M2 12l10 5 10-5" />
              </svg>
            </div>
            <p className="text-[13px] font-600 text-text mb-1">No pipelines yet</p>
            <p className="text-[12px] text-text-3">Click New to create one</p>
          </div>
        ) : (
          sorted.map((pipeline: Pipeline) => {
            const isActive = pipeline.id === selectedId
            const lastRunStatus = getLastRunStatus(pipeline.id)
            const totalTasks = pipeline.stages.reduce((s, st) => s + st.tasks.length, 0)

            return (
              <button
                key={pipeline.id}
                onClick={() => onSelect(pipeline.id)}
                className={`w-full text-left px-3 py-3 rounded-[10px] transition-all cursor-pointer border mb-1 ${
                  isActive
                    ? 'bg-accent-soft/50 border-accent-bright/20'
                    : 'bg-transparent border-transparent hover:bg-white/[0.03]'
                }`}
              >
                <div className="flex items-start justify-between gap-2 mb-1">
                  <span className={`text-[13px] font-600 leading-tight truncate ${isActive ? 'text-text' : 'text-text-2'}`}>
                    {pipeline.name}
                  </span>
                  {lastRunStatus && (
                    <span className={`flex-shrink-0 w-1.5 h-1.5 rounded-full mt-1 ${
                      lastRunStatus === 'running' ? 'bg-blue-400 animate-pulse' :
                      lastRunStatus === 'completed' ? 'bg-green-400' :
                      lastRunStatus === 'failed' ? 'bg-red-400' :
                      lastRunStatus === 'paused' ? 'bg-yellow-400' : 'bg-white/20'
                    }`} />
                  )}
                </div>
                <div className="flex items-center gap-2 text-[11px] text-text-3">
                  <span>{pipeline.stages.length} stage{pipeline.stages.length !== 1 ? 's' : ''}</span>
                  <span>·</span>
                  <span>{totalTasks} task{totalTasks !== 1 ? 's' : ''}</span>
                  <span>·</span>
                  <span>{relativeDate(pipeline.updatedAt)}</span>
                </div>
              </button>
            )
          })
        )}
      </div>
    </>
  )
}
