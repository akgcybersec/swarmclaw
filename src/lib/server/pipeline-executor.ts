import { loadPipelines, loadPipelineRuns, upsertPipelineRun, loadSessions, saveSessions, loadTasks, upsertTask } from './storage'
import { notify } from './ws-hub'
import { genId } from '../id'
import type { Pipeline, PipelineRun, PipelineRunStage, PipelineRunTask, BoardTask } from '@/types'

function patchRun(runId: string, patcher: (run: PipelineRun) => void) {
  const runs = loadPipelineRuns()
  const run = runs[runId] as PipelineRun | undefined
  if (!run) return
  patcher(run)
  run.updatedAt = Date.now()
  upsertPipelineRun(runId, run)
  notify('pipeline-runs')
}

function getOrCreateAgentSession(agentId: string): string {
  const sessions = loadSessions()
  // Reuse an existing pipeline session for this agent
  const existing = Object.values(sessions).find(
    (s: any) => s.agentId === agentId && s.sessionType === 'pipeline'
  ) as any
  if (existing) return existing.id

  const { loadAgents } = require('./storage')
  const agents = loadAgents()
  const agent = agents[agentId]
  if (!agent) throw new Error(`Agent "${agentId}" not found`)

  const id = genId()
  const now = Date.now()
  sessions[id] = {
    id,
    name: `[Pipeline] ${agent.name}`,
    cwd: null,
    user: 'pipeline',
    provider: agent.provider || 'claude-cli',
    model: agent.model || '',
    credentialId: agent.credentialId || null,
    apiEndpoint: agent.apiEndpoint || null,
    claudeSessionId: null,
    codexThreadId: null,
    opencodeSessionId: null,
    delegateResumeIds: { claudeCode: null, codex: null, opencode: null },
    messages: [],
    createdAt: now,
    lastActiveAt: now,
    sessionType: 'pipeline',
    agentId: agent.id,
    parentSessionId: null,
    tools: agent.tools || [],
    heartbeatEnabled: false,
    heartbeatIntervalSec: null,
  }
  saveSessions(sessions)
  notify('sessions')
  return id
}

export async function executePipelineRun(runId: string): Promise<void> {
  console.log(`[pipeline-executor] Starting execution for run ${runId}`)
  const runs = loadPipelineRuns()
  const run = runs[runId] as PipelineRun | undefined
  if (!run) {
    console.log(`[pipeline-executor] Run ${runId} not found`)
    return
  }

  const pipelines = loadPipelines()
  const pipeline = pipelines[run.pipelineId] as Pipeline | undefined
  if (!pipeline) {
    console.log(`[pipeline-executor] Pipeline ${run.pipelineId} not found`)
    patchRun(runId, r => { r.status = 'failed' })
    return
  }

  console.log(`[pipeline-executor] Executing pipeline "${pipeline.name}" with ${pipeline.stages.length} stages`)
  
  // Mark as running
  patchRun(runId, r => { r.status = 'running' })

  try {
    const { enqueueSessionRun } = await import('./session-run-manager')
    const sortedStages = [...pipeline.stages].sort((a, b) => a.order - b.order)

    for (const stage of sortedStages) {
      console.log(`[pipeline-executor] Processing stage "${stage.label}"`)
      const runStage = run.stages.find((rs: PipelineRunStage) => rs.stageId === stage.id)
      if (!runStage) continue

      // Start stage
      patchRun(runId, r => {
        const rs = r.stages.find(s => s.stageId === stage.id)
        if (rs) { rs.status = 'running'; rs.startedAt = Date.now() }
      })

      // Get/create agent session
      let sessionId: string
      try {
        sessionId = getOrCreateAgentSession(stage.agentId)
        patchRun(runId, r => {
          const rs = r.stages.find(s => s.stageId === stage.id)
          if (rs) rs.sessionId = sessionId
        })
      } catch (err: any) {
        patchRun(runId, r => {
          const rs = r.stages.find(s => s.stageId === stage.id)
          if (rs) { rs.status = 'failed'; (rs as any).error = err.message }
        })
        if (pipeline.failurePolicy === 'abort') {
          patchRun(runId, r => { r.status = 'failed' })
          return
        }
        continue
      }

      const sortedTasks = [...stage.tasks].sort((a, b) => a.order - b.order)
      let stageFailed = false

      for (const task of sortedTasks) {
        // Check if pipeline was cancelled
        const currentRun = loadPipelineRuns()[runId] as PipelineRun | undefined
        if (currentRun?.status === 'cancelled') {
          console.log(`[pipeline-executor] Pipeline cancelled, stopping execution`)
          return
        }

        if (!task.prompt?.trim()) {
          patchRun(runId, r => {
            const rs = r.stages.find(s => s.stageId === stage.id)
            const rt = rs?.tasks.find((t: PipelineRunTask) => t.taskId === task.id)
            if (rt) { rt.status = 'skipped'; rt.completedAt = Date.now() }
          })
          continue
        }

        // Create BoardTask for this pipeline task
        const boardTaskId = genId()
        const now = Date.now()
        const boardTask: BoardTask = {
          id: boardTaskId,
          title: task.label,
          description: task.prompt,
          status: 'queued',
          agentId: stage.agentId,
          projectId: pipeline.projectId || undefined,
          sessionId,
          createdAt: now,
          updatedAt: now,
          queuedAt: now,
        }
        upsertTask(boardTaskId, boardTask)
        notify('tasks')

        // Store boardTaskId in pipeline run task
        patchRun(runId, r => {
          const rs = r.stages.find(s => s.stageId === stage.id)
          const rt = rs?.tasks.find((t: PipelineRunTask) => t.taskId === task.id)
          if (rt) {
            rt.status = 'running'
            rt.startedAt = Date.now()
            ;(rt as any).boardTaskId = boardTaskId
          }
        })

        // Mark BoardTask as running
        const tasks = loadTasks()
        const boardTaskToUpdate = tasks[boardTaskId] as BoardTask
        if (boardTaskToUpdate) {
          boardTaskToUpdate.status = 'running'
          boardTaskToUpdate.startedAt = Date.now()
          boardTaskToUpdate.updatedAt = Date.now()
          upsertTask(boardTaskId, boardTaskToUpdate)
          notify('tasks')
        }

        // Send initial message to agent with task context
        const { enqueueSessionRun } = await import('./session-run-manager')
        enqueueSessionRun({
          sessionId,
          message: `[Pipeline Task: ${task.label}]\n\n${task.prompt}\n\n**Important:** When you have fully completed this task (including waiting for any scans, processing results, etc.), use manage_tasks to mark it complete:\n\nmanage_tasks({\n  action: "update",\n  id: "${boardTaskId}",\n  data: {\n    status: "completed",\n    result: "Detailed summary of what you accomplished (minimum 40 characters)"\n  }\n})`,
          source: 'pipeline',
          internal: false,
          mode: 'followup',
        })

        // Poll for task completion
        const TASK_TIMEOUT_MS = 30 * 60_000 // 30 minutes for long-running tasks
        const POLL_INTERVAL_MS = 2000
        const STATUS_CHECK_INTERVAL_MS = 2 * 60_000 // Ask agent for status every 2 minutes
        const startTime = Date.now()
        let lastStatusCheck = Date.now()

        try {
          while (true) {
            const now = Date.now()
            
            if (now - startTime > TASK_TIMEOUT_MS) {
              throw new Error('Task timed out after 30 minutes')
            }

            await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS))

            const tasks = loadTasks()
            const currentTask = tasks[boardTaskId] as BoardTask | undefined
            if (!currentTask) {
              throw new Error('Task was deleted')
            }

            // Periodically ask agent for status update
            if (currentTask.status === 'running' && (now - lastStatusCheck) > STATUS_CHECK_INTERVAL_MS) {
              console.log(`[pipeline-executor] Checking task ${boardTaskId} status with agent`)
              lastStatusCheck = now
              
              enqueueSessionRun({
                sessionId,
                message: `Status check: Are you done with task "${task.label}" (ID: ${boardTaskId})? If you have completed all the work, use manage_tasks to mark it complete with a detailed result summary. If you're still working, briefly describe what you're doing.`,
                source: 'pipeline',
                internal: false,
                mode: 'followup',
              })
            }

            if (currentTask.status === 'completed') {
              patchRun(runId, r => {
                const rs = r.stages.find(s => s.stageId === stage.id)
                const rt = rs?.tasks.find((t: PipelineRunTask) => t.taskId === task.id)
                if (rt) {
                  rt.status = 'completed'
                  rt.result = currentTask.result || ''
                  rt.completedAt = Date.now()
                }
              })
              break
            } else if (currentTask.status === 'failed') {
              throw new Error(currentTask.error || 'Task failed')
            }
          }
        } catch (err: any) {
          stageFailed = true
          patchRun(runId, r => {
            const rs = r.stages.find(s => s.stageId === stage.id)
            const rt = rs?.tasks.find((t: PipelineRunTask) => t.taskId === task.id)
            if (rt) { rt.status = 'failed'; rt.error = err.message; rt.completedAt = Date.now() }
          })

          if (pipeline.failurePolicy === 'abort') {
            patchRun(runId, r => {
              const rs = r.stages.find(s => s.stageId === stage.id)
              if (rs) { rs.status = 'failed'; rs.completedAt = Date.now() }
              r.status = 'failed'
            })
            return
          } else if (pipeline.failurePolicy === 'pause') {
            patchRun(runId, r => {
              const rs = r.stages.find(s => s.stageId === stage.id)
              if (rs) { rs.status = 'failed'; rs.completedAt = Date.now() }
              r.status = 'paused'
              r.pausedAt = { stageId: stage.id, taskId: task.id }
            })
            return
          }
          // 'continue' policy — move to next task
        }
      }

      // Complete stage
      patchRun(runId, r => {
        const rs = r.stages.find(s => s.stageId === stage.id)
        if (rs) {
          rs.status = stageFailed ? 'failed' : 'completed'
          rs.completedAt = Date.now()
        }
      })
    }

    // Complete run
    patchRun(runId, r => {
      if (r.status === 'running') {
        const anyFailed = r.stages.some((s: PipelineRunStage) => s.status === 'failed')
        r.status = anyFailed ? 'failed' : 'completed'
        r.completedAt = Date.now()
      }
    })
  } catch (err: any) {
    console.error('[pipeline-executor] Unhandled error:', err)
    patchRun(runId, r => { r.status = 'failed' })
  }
}
