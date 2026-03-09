import fs from 'fs'
import path from 'path'
import { loadPipelines, loadPipelineRuns, upsertPipelineRun, loadSessions, saveSessions, deleteSession, loadTasks, upsertTask } from './storage'
import { notify } from './ws-hub'
import { genId } from '../id'
import { WORKSPACE_DIR } from './data-dir'
import type { Pipeline, PipelineRun, PipelineRunStage, PipelineRunTask, BoardTask } from '@/types'

// --- Workspace Utilities ---

const PIPELINES_WORKSPACE = path.join(WORKSPACE_DIR, 'pipelines')

function sanitizePathSegment(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'stage'
}

function buildPipelineFolderName(pipelineId: string, pipelineName: string): string {
  return `${sanitizePathSegment(pipelineName)}-${pipelineId.slice(0, 8)}`
}

export function createPipelineWorkspace(runId: string, pipelineId: string, pipelineName: string): string {
  const dir = path.join(PIPELINES_WORKSPACE, buildPipelineFolderName(pipelineId, pipelineName), runId)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

export function deletePipelineRunWorkspace(workspaceDir: string): void {
  const resolvedDir = path.resolve(workspaceDir)
  const resolvedBase = path.resolve(PIPELINES_WORKSPACE)
  if (!resolvedDir.startsWith(resolvedBase + path.sep)) {
    console.error(`[pipeline-workspace] Refusing to delete unsafe path: ${resolvedDir}`)
    return
  }
  if (fs.existsSync(workspaceDir)) {
    fs.rmSync(workspaceDir, { recursive: true, force: true })
    console.log(`[pipeline-workspace] Deleted run workspace: ${workspaceDir}`)
  }
}

export function deletePipelineFolderWorkspace(pipelineId: string, pipelineName: string): void {
  const dir = path.join(PIPELINES_WORKSPACE, buildPipelineFolderName(pipelineId, pipelineName))
  const resolvedDir = path.resolve(dir)
  const resolvedBase = path.resolve(PIPELINES_WORKSPACE)
  if (!resolvedDir.startsWith(resolvedBase + path.sep)) {
    console.error(`[pipeline-workspace] Refusing to delete unsafe path: ${resolvedDir}`)
    return
  }
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true })
    console.log(`[pipeline-workspace] Deleted pipeline workspace: ${dir}`)
  }
}

export function createStageWorkspace(runWorkspaceDir: string, stageIndex: number, stageLabel: string): string {
  const dirName = `stage-${stageIndex}-${sanitizePathSegment(stageLabel)}`
  const dir = path.join(runWorkspaceDir, dirName)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

interface AssetFile {
  name: string
  absolutePath: string
  sizeBytes: number
  mtimeMs: number
  stageName: string
}

function collectStageAssets(runId: string, stageIds: string[], pipeline: Pipeline): AssetFile[] {
  const assets: AssetFile[] = []
  const runs = loadPipelineRuns()
  const run = runs[runId] as PipelineRun | undefined
  for (const stageId of stageIds) {
    const runStage = run?.stages.find((s: PipelineRunStage) => s.stageId === stageId)
    const stageDir = runStage?.workspaceDir ?? null
    if (!stageDir || !fs.existsSync(stageDir)) continue
    const stageDef = pipeline.stages.find(s => s.id === stageId)
    const stageName = stageDef?.label ?? stageId
    try {
      const entries = fs.readdirSync(stageDir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isFile()) continue
        const absPath = path.join(stageDir, entry.name)
        const stat = fs.statSync(absPath)
        assets.push({ name: entry.name, absolutePath: absPath, sizeBytes: stat.size, mtimeMs: stat.mtimeMs, stageName })
      }
    } catch {
      // ignore unreadable directories
    }
  }
  return assets
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

function formatAssetSummary(assets: AssetFile[]): string {
  if (assets.length === 0) return ''
  const byStage: Record<string, AssetFile[]> = {}
  for (const asset of assets) {
    if (!byStage[asset.stageName]) byStage[asset.stageName] = []
    byStage[asset.stageName].push(asset)
  }
  const lines: string[] = ['**Available Assets from Previous Stages:**\n']
  for (const [stageName, files] of Object.entries(byStage)) {
    lines.push(`From Stage "${stageName}":`)
    for (const f of files) {
      const mtime = new Date(f.mtimeMs).toISOString().replace('T', ' ').slice(0, 19)
      lines.push(`  - ${f.absolutePath}  (${formatFileSize(f.sizeBytes)}, modified ${mtime})`)
    }
    lines.push('')
  }
  return lines.join('\n')
}


function patchRun(runId: string, patcher: (run: PipelineRun) => void) {
  const runs = loadPipelineRuns()
  const run = runs[runId] as PipelineRun | undefined
  if (!run) return
  patcher(run)
  run.updatedAt = Date.now()
  upsertPipelineRun(runId, run)
  notify('pipeline-runs')
}

function createFreshPipelineSession(agentId: string, runId: string, stageLabel: string): string {
  const { loadAgents } = require('./storage')
  const agents = loadAgents()
  const agent = agents[agentId]
  if (!agent) throw new Error(`Agent "${agentId}" not found`)

  const id = genId()
  const now = Date.now()
  const sessions = loadSessions()
  sessions[id] = {
    id,
    name: `[Pipeline:${runId.slice(0, 8)}] ${stageLabel}`,
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
    tools: Array.from(new Set([...(agent.tools || []), 'manage_tasks'])),
    heartbeatEnabled: false,
    heartbeatIntervalSec: null,
  }
  saveSessions(sessions)
  notify('sessions')
  console.log(`[pipeline-executor] Created dedicated session ${id} for stage "${stageLabel}" (run ${runId})`)
  return id
}

function purgePipelineSession(sessionId: string): void {
  try {
    const { cancelSessionRuns } = require('./session-run-manager')
    cancelSessionRuns(sessionId, 'Pipeline stage complete — session purged')
  } catch { /* ignore if no runs */ }
  // Defer actual deletion to let any in-flight run completion handlers drain
  setTimeout(() => {
    deleteSession(sessionId)
    notify('sessions')
    console.log(`[pipeline-executor] Purged dedicated session ${sessionId}`)
  }, 10_000)
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

    for (const [stageIdx, stage] of sortedStages.entries()) {
      const runStage = run.stages[stageIdx] // Use index instead of ID
      if (!runStage) continue

      // Start stage
      patchRun(runId, r => {
        const rs = r.stages[stageIdx] // Use index instead of ID
        if (rs) { rs.status = 'running'; rs.startedAt = Date.now() }
      })

      // Create stage workspace directory
      const runWorkspaceDir = run.workspaceDir ?? createPipelineWorkspace(runId, pipeline.id, pipeline.name)
      const stageWorkspaceDir = createStageWorkspace(runWorkspaceDir, stageIdx + 1, stage.label)
      patchRun(runId, r => {
        const rs = r.stages[stageIdx] // Use index instead of ID
        if (rs) rs.workspaceDir = stageWorkspaceDir
      })

      // Create a fresh dedicated session for this stage
      let sessionId: string
      try {
        sessionId = createFreshPipelineSession(stage.agentId, runId, stage.label)
        patchRun(runId, r => {
          const rs = r.stages[stageIdx] // Use index instead of ID
          if (rs) rs.sessionId = sessionId
        })
      } catch (err: any) {
        patchRun(runId, r => {
          const rs = r.stages[stageIdx] // Use index instead of ID
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

      for (const [taskIndex, task] of sortedTasks.entries()) {
        // Check if pipeline was cancelled
        const currentRun = loadPipelineRuns()[runId] as PipelineRun | undefined
        if (currentRun?.status === 'cancelled') {
          console.log(`[pipeline-executor] Pipeline cancelled, stopping execution`)
          purgePipelineSession(sessionId)
          return
        }

        if (!task.prompt?.trim()) {
          patchRun(runId, r => {
            const rs = r.stages[stageIdx] // Use index instead of ID
            const rt = rs?.tasks[taskIndex] // Use index instead of ID
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
          const rs = r.stages[stageIdx] // Use index instead of ID
          const rt = rs?.tasks[taskIndex] // Use index instead of ID
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

        // Build asset summary if this stage references previous stages
        let assetBlock = ''
        if (stage.useAssetsFrom && stage.useAssetsFrom.length > 0) {
          const assets = collectStageAssets(runId, stage.useAssetsFrom, pipeline)
          assetBlock = formatAssetSummary(assets)
        }

        // Build full task message
        const workspaceNote = `**Your Workspace Directory:** ${stageWorkspaceDir}\nSave all output files here.
`
        const assetSection = assetBlock ? `${assetBlock}\n` : ''
        const taskMessage = `[Pipeline Task: ${task.label}]\n\n${workspaceNote}\n${assetSection}${task.prompt}\n\n**Important:** When you have fully completed this task (including waiting for any scans, processing results, etc.), use manage_tasks to mark it complete:\n\nmanage_tasks({\n  action: "update",\n  id: "${boardTaskId}",\n  data: {\n    status: "completed",\n    result: "Detailed summary of what you accomplished (minimum 40 characters)"\n  }\n})`

        // Send initial message to agent with task context
        const { enqueueSessionRun } = await import('./session-run-manager')
        enqueueSessionRun({
          sessionId,
          message: taskMessage,
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

            // Check for cancellation on every poll tick
            const pollRun = loadPipelineRuns()[runId] as PipelineRun | undefined
            if (pollRun?.status === 'cancelled') {
              console.log(`[pipeline-executor] Cancellation detected mid-task, aborting stage "${stage.label}"`)
              patchRun(runId, r => {
                const rs = r.stages.find(s => s.stageId === stage.id)
                if (rs) { rs.status = 'cancelled' as any; rs.completedAt = Date.now() }
                const rt = rs?.tasks.find((t: PipelineRunTask) => t.taskId === task.id)
                if (rt) { rt.status = 'cancelled' as any; rt.completedAt = Date.now() }
              })
              purgePipelineSession(sessionId)
              return
            }

            const tasks = loadTasks()
            const currentTask = tasks[boardTaskId] as BoardTask | undefined
            if (!currentTask) {
              throw new Error('Task was deleted')
            }

            // Check for completion/failure first before sending status checks
            if (currentTask.status === 'completed') {
              patchRun(runId, r => {
                const rs = r.stages[stageIdx] // Use stageIdx instead of ID
                const rt = rs?.tasks[taskIndex] // Match by index instead of ID
                if (rt) {
                  rt.status = 'completed'
                  rt.result = currentTask.result || ''
                  rt.completedAt = Date.now()
                }
              })
              notify('pipeline-runs')
              break
            } else if (currentTask.status === 'failed') {
              throw new Error(currentTask.error || 'Task failed')
            }

            // Only send status checks if task is still running
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
          }
        } catch (err: any) {
          stageFailed = true
          patchRun(runId, r => {
            const rs = r.stages[stageIdx] // Use stageIdx instead of ID
            const rt = rs?.tasks[taskIndex] // Use index instead of ID
            if (rt) { rt.status = 'failed'; rt.error = err.message; rt.completedAt = Date.now() }
          })

          if (pipeline.failurePolicy === 'abort') {
            patchRun(runId, r => {
              const rs = r.stages[stageIdx] // Use stageIdx instead of ID
              if (rs) { rs.status = 'failed'; rs.completedAt = Date.now() }
              r.status = 'failed'
            })
            purgePipelineSession(sessionId)
            return
          } else if (pipeline.failurePolicy === 'pause') {
            patchRun(runId, r => {
              const rs = r.stages[stageIdx] // Use stageIdx instead of ID
              if (rs) { rs.status = 'failed'; rs.completedAt = Date.now() }
              r.status = 'paused'
              r.pausedAt = { stageId: stage.id, taskId: task.id || `task-${taskIndex}` } // Fallback for undefined task.id
            })
            purgePipelineSession(sessionId)
            return
          }
          // 'continue' policy — move to next task
        }
      }

      // Complete stage
      patchRun(runId, r => {
        const rs = r.stages[stageIdx] // Use stageIdx instead of ID
        if (rs) {
          rs.status = stageFailed ? 'failed' : 'completed'
          rs.completedAt = Date.now()
        }
      })
      notify('pipeline-runs')

      // Purge the dedicated session — it served its purpose
      purgePipelineSession(sessionId)
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
