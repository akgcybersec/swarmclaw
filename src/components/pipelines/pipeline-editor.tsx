'use client'

import { useState } from 'react'
import type { Pipeline, PipelineStage, PipelineStageTask } from '@/types'
import { useAppStore } from '@/stores/use-app-store'

interface PipelineEditorProps {
  pipeline: Pipeline
  onSave: (updated: Omit<Pipeline, 'id' | 'createdAt' | 'updatedAt'>) => void
  onCancel: () => void
}

export function PipelineEditor({ pipeline, onSave, onCancel }: PipelineEditorProps) {
  const agents = useAppStore((s) => s.agents)
  const [name, setName] = useState(pipeline.name)
  const [description, setDescription] = useState(pipeline.description)
  const [stages, setStages] = useState<PipelineStage[]>(pipeline.stages)
  const [failurePolicy, setFailurePolicy] = useState(pipeline.failurePolicy)

  const addStage = () => {
    const newStage: PipelineStage = {
      id: `stage-${Date.now()}`,
      agentId: Object.keys(agents)[0] || '',
      label: `Stage ${stages.length + 1}`,
      tasks: [{
        id: `task-${Date.now()}`,
        label: 'New Task',
        prompt: 'Task prompt',
        order: 1
      }],
      dependsOn: [],
      order: stages.length + 1
    }
    setStages([...stages, newStage])
  }

  const removeStage = (stageId: string) => {
    setStages(stages.filter(s => s.id !== stageId))
  }

  const updateStage = (stageId: string, updates: Partial<PipelineStage>) => {
    setStages(stages.map(s => s.id === stageId ? { ...s, ...updates } : s))
  }

  const addTask = (stageId: string) => {
    setStages(stages.map(stage => {
      if (stage.id === stageId) {
        const newTask: PipelineStageTask = {
          id: `task-${Date.now()}`,
          label: 'New Task',
          prompt: 'Task prompt',
          order: stage.tasks.length + 1
        }
        return { ...stage, tasks: [...stage.tasks, newTask] }
      }
      return stage
    }))
  }

  const removeTask = (stageId: string, taskId: string) => {
    setStages(stages.map(stage => {
      if (stage.id === stageId) {
        return { ...stage, tasks: stage.tasks.filter(t => t.id !== taskId) }
      }
      return stage
    }))
  }

  const updateTask = (stageId: string, taskId: string, updates: Partial<PipelineStageTask>) => {
    setStages(stages.map(stage => {
      if (stage.id === stageId) {
        return {
          ...stage,
          tasks: stage.tasks.map(t => t.id === taskId ? { ...t, ...updates } : t)
        }
      }
      return stage
    }))
  }

  const handleSave = () => {
    // Validate all tasks have prompts
    for (const stage of stages) {
      for (const task of stage.tasks) {
        if (!task.prompt?.trim()) {
          alert('Each task must have a prompt. Please fill in all task prompts before saving.')
          return
        }
      }
    }

    onSave({
      name,
      description,
      stages: stages.map((stage, index) => ({
        ...stage,
        order: index + 1,
        tasks: stage.tasks.map((task, taskIndex) => ({
          ...task,
          order: taskIndex + 1
        }))
      })),
      failurePolicy,
      notifySettings: pipeline.notifySettings,
      projectId: pipeline.projectId
    })
  }

  return (
    <div className="p-8 max-w-[1200px] mx-auto">
      {/* Header */}
      <div className="mb-6">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full bg-transparent border-none outline-none font-display text-[28px] font-800 text-text mb-2 px-0"
          placeholder="Pipeline Name"
        />
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="w-full bg-transparent border-none outline-none text-[15px] text-text-3 resize-none px-0"
          placeholder="Pipeline Description"
          rows={2}
        />
      </div>

      {/* Settings */}
      <div className="mb-6 p-4 rounded-[14px] bg-white/[0.02] border border-white/[0.06]">
        <label className="block text-[13px] text-text-3 mb-2">Failure Policy</label>
        <select
          value={failurePolicy}
          onChange={(e) => setFailurePolicy(e.target.value as any)}
          className="px-3 py-2 rounded-[10px] bg-white/[0.05] border border-white/[0.08] text-text text-[14px] outline-none cursor-pointer"
        >
          <option value="pause">Pause on Failure</option>
          <option value="continue">Continue on Failure</option>
          <option value="abort">Abort on Failure</option>
        </select>
      </div>

      {/* Stages */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-[20px] font-700 text-text">Stages</h2>
          <button
            onClick={addStage}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-[10px] border-none bg-accent-bright text-white text-[13px] font-600
              cursor-pointer hover:brightness-110 active:scale-[0.97] transition-all"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Add Stage
          </button>
        </div>

        <div className="space-y-4">
          {stages.map((stage, index) => (
            <div key={stage.id} className="p-6 rounded-[16px] bg-white/[0.02] border border-white/[0.08]">
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 w-10 h-10 rounded-[12px] bg-accent-soft flex items-center justify-center text-accent-bright font-700 text-[16px]">
                  {index + 1}
                </div>
                <div className="flex-1">
                  <div className="flex items-start gap-3 mb-4">
                    <input
                      type="text"
                      value={stage.label}
                      onChange={(e) => updateStage(stage.id, { label: e.target.value })}
                      className="flex-1 bg-transparent border-none outline-none font-600 text-[17px] text-text px-0"
                      placeholder="Stage Name"
                    />
                    <select
                      value={stage.agentId}
                      onChange={(e) => updateStage(stage.id, { agentId: e.target.value })}
                      className="px-3 py-1.5 rounded-[8px] bg-white/[0.05] border border-white/[0.08] text-text text-[13px] outline-none cursor-pointer"
                    >
                      <option value="">Select Agent</option>
                      {Object.values(agents).map((agent: any) => (
                        <option key={agent.id} value={agent.id}>{agent.name}</option>
                      ))}
                    </select>
                    <button
                      onClick={() => removeStage(stage.id)}
                      className="p-1.5 rounded-[8px] border-none bg-red-500/10 text-red-400 hover:bg-red-500/20 cursor-pointer transition-all"
                      title="Remove Stage"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M18 6L6 18M6 6l12 12" />
                      </svg>
                    </button>
                  </div>

                  {/* Tasks */}
                  <div className="space-y-2">
                    {stage.tasks.map((task, taskIndex) => (
                      <div key={task.id} className="p-3 rounded-[10px] bg-white/[0.03] border border-white/[0.04]">
                        <div className="flex items-start gap-3">
                          <span className="flex-shrink-0 w-6 h-6 rounded-full bg-white/[0.06] flex items-center justify-center text-text-3 text-[11px] font-600">
                            {taskIndex + 1}
                          </span>
                          <div className="flex-1 space-y-2">
                            <input
                              type="text"
                              value={task.label}
                              onChange={(e) => updateTask(stage.id, task.id, { label: e.target.value })}
                              className="w-full bg-transparent border-none outline-none font-500 text-[14px] text-text px-0"
                              placeholder="Task Name"
                            />
                            <textarea
                              value={task.prompt}
                              onChange={(e) => updateTask(stage.id, task.id, { prompt: e.target.value })}
                              className="w-full bg-transparent border-none outline-none text-[13px] text-text-3 resize-none px-0"
                              placeholder="Task Prompt"
                              rows={2}
                            />
                          </div>
                          <button
                            onClick={() => removeTask(stage.id, task.id)}
                            className="p-1 rounded-[6px] border-none bg-red-500/10 text-red-400 hover:bg-red-500/20 cursor-pointer transition-all"
                            title="Remove Task"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M18 6L6 18M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    ))}
                    <button
                      onClick={() => addTask(stage.id)}
                      className="w-full py-2 rounded-[8px] border border-dashed border-white/[0.12] bg-transparent text-text-3 text-[13px] font-500
                        cursor-pointer hover:border-accent-bright/30 hover:text-accent-bright transition-all"
                    >
                      + Add Task
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        <button
          onClick={handleSave}
          className="px-6 py-3 rounded-[12px] border-none bg-accent-bright text-white text-[14px] font-600
            cursor-pointer hover:brightness-110 active:scale-[0.97] transition-all"
        >
          Save Changes
        </button>
        <button
          onClick={onCancel}
          className="px-6 py-3 rounded-[12px] border border-white/[0.12] bg-transparent text-text text-[14px] font-600
            cursor-pointer hover:bg-white/[0.04] active:scale-[0.97] transition-all"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
