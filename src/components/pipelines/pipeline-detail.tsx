'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAppStore } from '@/stores/use-app-store'
import { deletePipeline, startPipelineRun, updatePipeline, cancelPipelineRun } from '@/lib/pipelines'
import type { Pipeline, PipelineRun, PipelineRunStage, PipelineRunTask, PipelineStage, PipelineStageTask } from '@/types'

function relativeDate(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function duration(startedAt: number | null | undefined, completedAt: number | null | undefined): string | null {
  if (!startedAt) return null
  const end = completedAt ?? Date.now()
  const ms = end - startedAt
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`
}

function StatusBadge({ status }: { status: string }) {
  const cfg: Record<string, { dot: string; text: string; label: string }> = {
    pending:   { dot: 'bg-white/20',              text: 'text-text-3',    label: 'Pending' },
    running:   { dot: 'bg-blue-400 animate-pulse', text: 'text-blue-400',  label: 'Running' },
    completed: { dot: 'bg-green-400',              text: 'text-green-400', label: 'Done' },
    failed:    { dot: 'bg-red-400',                text: 'text-red-400',   label: 'Failed' },
    paused:    { dot: 'bg-yellow-400',             text: 'text-yellow-400',label: 'Paused' },
    skipped:   { dot: 'bg-white/25',               text: 'text-text-3',    label: 'Skipped' },
    cancelled: { dot: 'bg-white/20',               text: 'text-text-3',    label: 'Cancelled' },
  }
  const c = cfg[status] ?? cfg.pending
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] font-600 ${c.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${c.dot}`} />
      {c.label}
    </span>
  )
}

interface PipelineDetailProps {
  pipelineId: string
  onDeleted: () => void
}

export function PipelineDetail({ pipelineId, onDeleted }: PipelineDetailProps) {
  const pipelines = useAppStore((s) => s.pipelines)
  const pipelineRuns = useAppStore((s) => s.pipelineRuns)
  const loadPipelines = useAppStore((s) => s.loadPipelines)
  const loadPipelineRuns = useAppStore((s) => s.loadPipelineRuns)
  const agents = useAppStore((s) => s.agents)
  const setActiveView = useAppStore((s) => s.setActiveView)
  const setEditingTaskId = useAppStore((s) => s.setEditingTaskId)

  const pipeline = pipelines[pipelineId] as Pipeline | undefined
  const [tab, setTab] = useState<'overview' | 'runs' | 'edit'>('overview')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [running, setRunning] = useState(false)
  const [saving, setSaving] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)

  // Edit state
  const [editName, setEditName] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [editStages, setEditStages] = useState<PipelineStage[]>([])
  const [editPolicy, setEditPolicy] = useState<Pipeline['failurePolicy']>('pause')

  const enterEdit = () => {
    if (!pipeline) return
    setEditName(pipeline.name)
    setEditDesc(pipeline.description)
    setEditStages(JSON.parse(JSON.stringify(pipeline.stages)))
    setEditPolicy(pipeline.failurePolicy)
    setTab('edit')
  }

  const handleSave = async () => {
    if (!pipeline) return
    setSaving(true)
    try {
      await updatePipeline(pipelineId, {
        name: editName || pipeline.name,
        description: editDesc,
        stages: editStages.map((st, i) => ({
          ...st,
          order: i + 1,
          tasks: st.tasks.map((t, j) => ({ ...t, order: j + 1 }))
        })),
        failurePolicy: editPolicy,
        notifySettings: pipeline.notifySettings,
        projectId: pipeline.projectId
      })
      await loadPipelines()
      setTab('overview')
    } catch (err) {
      console.error('[pipelines] save error:', err)
    } finally {
      setSaving(false)
    }
  }

  const handleRun = async () => {
    if (running) return
    setRunning(true)
    try {
      const run = await startPipelineRun(pipelineId)
      setSelectedRunId(run.id)
      await loadPipelineRuns()
      setTab('runs')
    } catch (err) {
      console.error('[pipelines] run error:', err)
    } finally {
      setRunning(false)
    }
  }

  const handleDelete = async () => {
    try {
      await deletePipeline(pipelineId)
      await loadPipelines()
      onDeleted()
    } catch (err) {
      console.error('[pipelines] delete error:', err)
    }
  }

  const handleCancel = async () => {
    if (!selectedRun || cancelling) return
    setCancelling(true)
    try {
      await cancelPipelineRun(pipelineId, selectedRun.id)
      await loadPipelineRuns()
    } catch (err) {
      console.error('[pipelines] cancel error:', err)
    } finally {
      setCancelling(false)
    }
  }

  // Edit helpers
  const addStage = () => {
    const newStage: PipelineStage = {
      id: `stage-${Date.now()}`,
      agentId: Object.keys(agents)[0] || '',
      label: `Stage ${editStages.length + 1}`,
      tasks: [{ id: `task-${Date.now()}`, label: 'Task 1', prompt: '', order: 1 }],
      dependsOn: [],
      order: editStages.length + 1
    }
    setEditStages([...editStages, newStage])
  }

  const removeStage = (stageId: string) =>
    setEditStages(editStages.filter(s => s.id !== stageId))

  const updateStage = (stageId: string, patch: Partial<PipelineStage>) =>
    setEditStages(editStages.map(s => s.id === stageId ? { ...s, ...patch } : s))

  const addTask = (stageId: string) =>
    setEditStages(editStages.map(s => s.id === stageId ? {
      ...s,
      tasks: [...s.tasks, { id: `task-${Date.now()}`, label: `Task ${s.tasks.length + 1}`, prompt: '', order: s.tasks.length + 1 }]
    } : s))

  const removeTask = (stageId: string, taskId: string) =>
    setEditStages(editStages.map(s => s.id === stageId ? {
      ...s, tasks: s.tasks.filter(t => t.id !== taskId)
    } : s))

  const updateTask = (stageId: string, taskId: string, patch: Partial<PipelineStageTask>) =>
    setEditStages(editStages.map(s => s.id === stageId ? {
      ...s, tasks: s.tasks.map(t => t.id === taskId ? { ...t, ...patch } : t)
    } : s))

  const runs = Object.values(pipelineRuns)
    .filter((r: PipelineRun) => r.pipelineId === pipelineId)
    .sort((a: PipelineRun, b: PipelineRun) => b.createdAt - a.createdAt)

  const selectedRun = (selectedRunId ? pipelineRuns[selectedRunId] : runs[0]) as PipelineRun | undefined

  const hasActiveRun = runs.some((r: PipelineRun) => r.status === 'running' || r.status === 'pending')

  const poll = useCallback(() => { loadPipelineRuns() }, [loadPipelineRuns])
  useEffect(() => {
    if (!hasActiveRun) return
    const t = setInterval(poll, 1500)
    return () => clearInterval(t)
  }, [hasActiveRun, poll])

  useEffect(() => {
    if (hasActiveRun && tab === 'overview') setTab('runs')
  }, [hasActiveRun])

  if (!pipeline) return null

  const stageMap: Record<string, PipelineStage> = {}
  const taskMap: Record<string, PipelineStageTask> = {}
  for (const st of pipeline.stages) {
    stageMap[st.id] = st
    for (const tk of st.tasks) taskMap[tk.id] = tk
  }

  return (
    <div className="flex-1 flex flex-col h-full min-h-0 min-w-0">
      {/* Header */}
      <div className="px-6 pt-5 pb-0 shrink-0">
        <div className="flex items-start justify-between mb-4">
          <div className="flex-1 min-w-0">
            <h1 className="font-display text-[18px] font-700 text-text tracking-[-0.02em] truncate">{pipeline.name}</h1>
            {pipeline.description && (
              <p className="text-[13px] text-text-3 mt-0.5 truncate">{pipeline.description}</p>
            )}
          </div>
          <div className="flex items-center gap-2 ml-4 shrink-0">
            <button
              onClick={handleRun}
              disabled={running}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] bg-green-500/15 text-green-400 text-[12px] font-600 hover:bg-green-500/25 transition-all cursor-pointer disabled:opacity-50"
              style={{ fontFamily: 'inherit' }}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z" />
              </svg>
              {running ? 'Starting…' : 'Run'}
            </button>
            <button
              onClick={enterEdit}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] bg-white/[0.04] text-text-3 text-[12px] font-600 hover:bg-white/[0.07] hover:text-text-2 transition-all cursor-pointer"
              style={{ fontFamily: 'inherit' }}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
              Edit
            </button>
            {confirmDelete ? (
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-text-3">Sure?</span>
                <button onClick={handleDelete} className="px-2 py-1 rounded-[6px] bg-red-500/20 text-red-400 text-[11px] font-600 hover:bg-red-500/30 cursor-pointer transition-all" style={{ fontFamily: 'inherit' }}>Delete</button>
                <button onClick={() => setConfirmDelete(false)} className="px-2 py-1 rounded-[6px] bg-white/[0.04] text-text-3 text-[11px] font-600 hover:bg-white/[0.07] cursor-pointer transition-all" style={{ fontFamily: 'inherit' }}>Cancel</button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                className="p-1.5 rounded-[8px] bg-transparent text-text-3 hover:bg-red-500/10 hover:text-red-400 transition-all cursor-pointer"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Tabs */}
        {tab !== 'edit' && (
          <div className="flex gap-0.5 border-b border-white/[0.06]">
            {(['overview', 'runs'] as const).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-3 py-2 text-[12px] font-600 border-b-2 -mb-px transition-all cursor-pointer capitalize ${
                  tab === t
                    ? 'border-accent-bright text-accent-bright'
                    : 'border-transparent text-text-3 hover:text-text-2'
                }`}
                style={{ fontFamily: 'inherit' }}
              >
                {t}{t === 'runs' && runs.length > 0 && (
                  <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] ${hasActiveRun ? 'bg-blue-400/20 text-blue-400' : 'bg-white/[0.06] text-text-3'}`}>{runs.length}</span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">

        {/* Overview Tab */}
        {tab === 'overview' && (
          <div className="px-6 py-4">
            {/* Stats row */}
            <div className="flex items-center gap-4 mb-5 text-[12px]">
              <span className="text-text-3"><span className="text-text font-600">{pipeline.stages.length}</span> stages</span>
              <span className="text-white/20">·</span>
              <span className="text-text-3"><span className="text-text font-600">{pipeline.stages.reduce((s, st) => s + st.tasks.length, 0)}</span> tasks</span>
              <span className="text-white/20">·</span>
              <span className="text-text-3 capitalize"><span className="text-text font-600">{pipeline.failurePolicy}</span> on failure</span>
              <span className="text-white/20">·</span>
              <span className="text-text-3">Updated {relativeDate(pipeline.updatedAt)}</span>
            </div>

            {/* Stages */}
            <div className="space-y-2">
              {[...pipeline.stages].sort((a, b) => a.order - b.order).map((stage, idx) => {
                const agent = agents[stage.agentId]
                return (
                  <div key={stage.id} className="rounded-[10px] border border-white/[0.06] overflow-hidden">
                    <div className="flex items-center gap-3 px-4 py-2.5 bg-white/[0.02]">
                      <span className="w-5 h-5 rounded-full bg-accent-soft flex items-center justify-center text-accent-bright text-[10px] font-700 flex-shrink-0">
                        {idx + 1}
                      </span>
                      <span className="text-[13px] font-600 text-text flex-1">{stage.label}</span>
                      {agent && (
                        <span className="text-[11px] text-text-3 bg-white/[0.04] px-2 py-0.5 rounded-full">{agent.name}</span>
                      )}
                    </div>
                    <div className="divide-y divide-white/[0.04]">
                      {[...stage.tasks].sort((a, b) => a.order - b.order).map((task, tIdx) => (
                        <div key={task.id} className="flex items-start gap-3 px-4 py-2.5">
                          <span className="text-[11px] text-text-3 w-4 text-right flex-shrink-0 mt-0.5">{tIdx + 1}</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-[12px] font-500 text-text-2">{task.label}</p>
                            {task.prompt && <p className="text-[11px] text-text-3 mt-0.5 leading-relaxed">{task.prompt}</p>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Runs Tab */}
        {tab === 'runs' && (
          <div className="flex h-full min-h-0">
            {/* Run list sidebar (only shown when >1 run) */}
            {runs.length > 1 && (
              <div className="w-[150px] shrink-0 border-r border-white/[0.06] overflow-y-auto py-2 px-2">
                {runs.map((run: PipelineRun) => (
                  <button key={run.id} onClick={() => setSelectedRunId(run.id)}
                    className={`w-full text-left px-2.5 py-2 rounded-[8px] mb-1 transition-all cursor-pointer ${selectedRun?.id === run.id ? 'bg-accent-soft/40' : 'hover:bg-white/[0.03]'}`}>
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                        run.status === 'running' ? 'bg-blue-400 animate-pulse' :
                        run.status === 'completed' ? 'bg-green-400' :
                        run.status === 'failed' ? 'bg-red-400' :
                        run.status === 'paused' ? 'bg-yellow-400' : 'bg-white/20'
                      }`} />
                      <span className="text-[11px] font-600 text-text-2 capitalize">{run.status}</span>
                    </div>
                    <div className="text-[10px] text-text-3">{relativeDate(run.createdAt)}</div>
                  </button>
                ))}
              </div>
            )}

            {/* Run detail */}
            <div className="flex-1 overflow-y-auto px-6 py-4 min-w-0">
              {!selectedRun ? (
                <div className="text-center py-12">
                  <p className="text-[13px] text-text-3 mb-3">No runs yet</p>
                  <button onClick={handleRun}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-[8px] bg-green-500/15 text-green-400 text-[12px] font-600 hover:bg-green-500/25 cursor-pointer transition-all"
                    style={{ fontFamily: 'inherit' }}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                    Run Pipeline
                  </button>
                </div>
              ) : (
                <>
                  {/* Run header */}
                  <div className="flex items-center gap-3 mb-5">
                    <StatusBadge status={selectedRun.status} />
                    {selectedRun.status === 'running' && (
                      <>
                        <span className="text-[11px] text-blue-400/70 animate-pulse">Executing…</span>
                        <button
                          onClick={handleCancel}
                          disabled={cancelling}
                          className="px-2.5 py-1 rounded-[6px] bg-red-500/15 text-red-400 text-[11px] font-600 hover:bg-red-500/25 cursor-pointer transition-all disabled:opacity-50"
                          style={{ fontFamily: 'inherit' }}
                        >
                          {cancelling ? 'Cancelling…' : 'Cancel'}
                        </button>
                      </>
                    )}
                    <span className="text-[11px] text-text-3 ml-auto">{relativeDate(selectedRun.createdAt)}</span>
                    {selectedRun.completedAt && (
                      <span className="text-[11px] text-text-3">
                        {(() => { const ms = selectedRun.completedAt! - selectedRun.createdAt; return ms < 60_000 ? `${(ms/1000).toFixed(1)}s` : `${Math.floor(ms/60_000)}m ${Math.floor((ms%60_000)/1000)}s` })()}
                      </span>
                    )}
                  </div>

                  {/* Stages */}
                  <div className="space-y-3">
                    {selectedRun.stages.map((rs: PipelineRunStage, stageIdx: number) => {
                      const stageDef = stageMap[rs.stageId]
                      const agent = stageDef ? agents[stageDef.agentId] : null
                      const isActive = rs.status === 'running'
                      const isDone = rs.status === 'completed'
                      const isFailed = rs.status === 'failed'

                      return (
                        <div key={rs.stageId} className={`rounded-[10px] border overflow-hidden transition-colors ${
                          isActive ? 'border-blue-400/30' :
                          isDone ? 'border-green-400/20' :
                          isFailed ? 'border-red-400/20' : 'border-white/[0.06]'
                        }`}>
                          {/* Stage header */}
                          <div className="flex items-center gap-3 px-4 py-2.5 bg-white/[0.02]">
                            <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-700 flex-shrink-0 ${
                              isActive ? 'bg-blue-400/20 text-blue-400' :
                              isDone ? 'bg-green-400/20 text-green-400' :
                              isFailed ? 'bg-red-400/20 text-red-400' : 'bg-white/[0.06] text-text-3'
                            }`}>{stageIdx + 1}</span>
                            <span className="text-[13px] font-600 text-text flex-1">{stageDef?.label ?? `Stage ${stageIdx + 1}`}</span>
                            {agent && <span className="text-[11px] text-text-3 bg-white/[0.04] px-2 py-0.5 rounded-full">{(agent as any).name}</span>}
                            {rs.startedAt && <span className="text-[11px] text-text-3">{rs.completedAt ? `${((rs.completedAt - rs.startedAt)/1000).toFixed(1)}s` : '…'}</span>}
                            <StatusBadge status={rs.status} />
                          </div>

                          {/* Tasks */}
                          <div className="divide-y divide-white/[0.04]">
                            {rs.tasks.map((rt: PipelineRunTask, taskIdx: number) => {
                              const taskDef = taskMap[rt.taskId]
                              const boardTaskId = (rt as any).boardTaskId
                              return (
                                <div key={rt.taskId} className="px-4 py-3">
                                  <div className="flex items-center gap-3">
                                    <span className="text-[11px] text-text-3 w-4 text-right flex-shrink-0">{taskIdx + 1}</span>
                                    <div className="flex-1 min-w-0">
                                      <div className="flex flex-col gap-0.5">
                                        <span className={`text-[12px] font-500 ${
                                          rt.status === 'running' ? 'text-blue-300' :
                                          rt.status === 'completed' ? 'text-text-2' :
                                          rt.status === 'failed' ? 'text-red-300' : 'text-text-3'
                                        }`}>
                                          {taskDef?.label ?? `Task ${taskIdx + 1}`}
                                          {rt.status === 'running' && <span className="ml-2 text-[10px] text-blue-400/70 animate-pulse">running…</span>}
                                        </span>
                                        {boardTaskId && (
                                          <div className="flex items-center gap-2">
                                            <span className="text-[10px] text-text-3 font-mono">ID: {boardTaskId}</span>
                                            <button
                                              onClick={() => {
                                                setActiveView('tasks')
                                                setEditingTaskId(boardTaskId)
                                              }}
                                              className="text-[10px] text-accent-bright/70 hover:text-accent-bright hover:underline cursor-pointer"
                                            >
                                              View Task →
                                            </button>
                                            {rs.sessionId && (
                                              <button
                                                onClick={() => {
                                                  const setCurrentSession = useAppStore.getState().setCurrentSession
                                                  setCurrentSession(rs.sessionId!)
                                                  setActiveView('agents')
                                                }}
                                                className="text-[10px] text-blue-400/70 hover:text-blue-400 hover:underline cursor-pointer"
                                              >
                                                View Agent Chat →
                                              </button>
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                    {rt.startedAt && rt.completedAt && (
                                      <span className="text-[10px] text-text-3">{`${((rt.completedAt - rt.startedAt)/1000).toFixed(1)}s`}</span>
                                    )}
                                    <StatusBadge status={rt.status} />
                                  </div>
                                  {rt.result && (
                                    <div className="mt-2 ml-7 p-3 rounded-[8px] bg-white/[0.03] border border-white/[0.05]">
                                      <p className="text-[11px] text-text-2 leading-relaxed whitespace-pre-wrap break-words">
                                        {rt.result.length > 600 ? rt.result.slice(0, 600) + '…' : rt.result}
                                      </p>
                                    </div>
                                  )}
                                  {rt.error && (
                                    <div className="mt-2 ml-7 p-2.5 rounded-[8px] bg-red-500/[0.06] border border-red-400/20">
                                      <p className="text-[11px] text-red-400 leading-relaxed">{rt.error}</p>
                                    </div>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )
                    })}
                  </div>

                  {/* Paused state */}
                  {selectedRun.status === 'paused' && (
                    <div className="mt-4 p-4 rounded-[10px] bg-yellow-400/[0.06] border border-yellow-400/20">
                      <p className="text-[12px] font-600 text-yellow-400 mb-1">Pipeline paused due to task failure</p>
                      <p className="text-[11px] text-text-3 mb-3">Choose how to proceed with the failed task.</p>
                      <div className="flex gap-2">
                        <button className="px-3 py-1.5 rounded-[7px] bg-yellow-400/15 text-yellow-400 text-[11px] font-600 hover:bg-yellow-400/25 cursor-pointer transition-all" style={{ fontFamily: 'inherit' }}>Retry Task</button>
                        <button className="px-3 py-1.5 rounded-[7px] bg-white/[0.06] text-text-2 text-[11px] font-600 hover:bg-white/[0.09] cursor-pointer transition-all" style={{ fontFamily: 'inherit' }}>Skip Task</button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {/* Edit Tab */}
        {tab === 'edit' && (
          <div className="px-6 py-4">
            {/* Name & Description */}
            <div className="mb-5 space-y-3">
              <div>
                <label className="block text-[11px] font-600 text-text-3 uppercase tracking-wider mb-1.5">Name</label>
                <input
                  type="text"
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  className="w-full px-3 py-2 rounded-[8px] bg-white/[0.04] border border-white/[0.08] text-text text-[13px] outline-none focus:border-accent-bright/40 transition-colors"
                />
              </div>
              <div>
                <label className="block text-[11px] font-600 text-text-3 uppercase tracking-wider mb-1.5">Description</label>
                <textarea
                  value={editDesc}
                  onChange={e => setEditDesc(e.target.value)}
                  rows={2}
                  className="w-full px-3 py-2 rounded-[8px] bg-white/[0.04] border border-white/[0.08] text-text text-[13px] outline-none focus:border-accent-bright/40 transition-colors resize-none"
                />
              </div>
              <div>
                <label className="block text-[11px] font-600 text-text-3 uppercase tracking-wider mb-1.5">Failure Policy</label>
                <select
                  value={editPolicy}
                  onChange={e => setEditPolicy(e.target.value as Pipeline['failurePolicy'])}
                  className="px-3 py-2 rounded-[8px] bg-white/[0.04] border border-white/[0.08] text-text text-[13px] outline-none cursor-pointer"
                >
                  <option value="pause">Pause on failure</option>
                  <option value="continue">Continue on failure</option>
                  <option value="abort">Abort on failure</option>
                </select>
              </div>
            </div>

            {/* Stages editor */}
            <div className="mb-4">
              <div className="flex items-center justify-between mb-3">
                <label className="text-[11px] font-600 text-text-3 uppercase tracking-wider">Stages</label>
                <button
                  onClick={addStage}
                  className="flex items-center gap-1 text-[11px] font-600 text-accent-bright hover:text-accent-bright/80 cursor-pointer transition-colors"
                  style={{ fontFamily: 'inherit' }}
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  Add Stage
                </button>
              </div>

              <div className="space-y-3">
                {editStages.map((stage, idx) => (
                  <div key={stage.id} className="rounded-[10px] border border-white/[0.08] overflow-hidden">
                    {/* Stage header */}
                    <div className="flex items-center gap-2 px-3 py-2.5 bg-white/[0.03]">
                      <span className="w-5 h-5 rounded-full bg-accent-soft flex items-center justify-center text-accent-bright text-[10px] font-700 flex-shrink-0">
                        {idx + 1}
                      </span>
                      <input
                        type="text"
                        value={stage.label}
                        onChange={e => updateStage(stage.id, { label: e.target.value })}
                        className="flex-1 bg-transparent border-none outline-none text-[13px] font-600 text-text min-w-0"
                        placeholder="Stage name"
                      />
                      <select
                        value={stage.agentId}
                        onChange={e => updateStage(stage.id, { agentId: e.target.value })}
                        className="px-2 py-1 rounded-[6px] bg-white/[0.05] border border-white/[0.08] text-text-2 text-[11px] outline-none cursor-pointer max-w-[140px]"
                      >
                        <option value="">Select agent</option>
                        {Object.values(agents).map((a: any) => (
                          <option key={a.id} value={a.id}>{a.name}</option>
                        ))}
                      </select>
                      <button
                        onClick={() => removeStage(stage.id)}
                        className="p-1 rounded-[5px] text-text-3 hover:bg-red-500/10 hover:text-red-400 transition-all cursor-pointer flex-shrink-0"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
                      </button>
                    </div>

                    {/* Tasks */}
                    <div className="divide-y divide-white/[0.04]">
                      {stage.tasks.map((task, tIdx) => (
                        <div key={task.id} className="flex items-start gap-2 px-3 py-2.5">
                          <span className="text-[11px] text-text-3 w-4 text-right flex-shrink-0 mt-2">{tIdx + 1}</span>
                          <div className="flex-1 min-w-0 space-y-1.5">
                            <input
                              type="text"
                              value={task.label}
                              onChange={e => updateTask(stage.id, task.id, { label: e.target.value })}
                              className="w-full bg-transparent border-none outline-none text-[12px] font-500 text-text"
                              placeholder="Task name"
                            />
                            <textarea
                              value={task.prompt}
                              onChange={e => updateTask(stage.id, task.id, { prompt: e.target.value })}
                              rows={2}
                              className="w-full bg-white/[0.03] border border-white/[0.06] rounded-[6px] px-2 py-1.5 text-[11px] text-text-3 outline-none focus:border-accent-bright/30 resize-none transition-colors"
                              placeholder="Task prompt"
                            />
                          </div>
                          <button
                            onClick={() => removeTask(stage.id, task.id)}
                            className="p-1 rounded-[5px] text-text-3 hover:bg-red-500/10 hover:text-red-400 transition-all cursor-pointer flex-shrink-0 mt-1.5"
                          >
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
                          </button>
                        </div>
                      ))}
                      <button
                        onClick={() => addTask(stage.id)}
                        className="w-full py-2 text-[11px] text-text-3 hover:text-accent-bright hover:bg-accent-bright/5 transition-all cursor-pointer text-center"
                        style={{ fontFamily: 'inherit' }}
                      >
                        + Add Task
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Save/Cancel */}
            <div className="flex items-center gap-2 pt-2 border-t border-white/[0.06]">
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 rounded-[8px] bg-accent-bright text-white text-[12px] font-600 hover:brightness-110 transition-all cursor-pointer disabled:opacity-50"
                style={{ fontFamily: 'inherit' }}
              >
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
              <button
                onClick={() => setTab('overview')}
                className="px-4 py-2 rounded-[8px] bg-white/[0.04] text-text-2 text-[12px] font-600 hover:bg-white/[0.07] transition-all cursor-pointer"
                style={{ fontFamily: 'inherit' }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
