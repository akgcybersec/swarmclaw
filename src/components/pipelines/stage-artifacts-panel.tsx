'use client'

import { useEffect, useState, useCallback } from 'react'
import { api } from '@/lib/api-client'

interface ArtifactFile {
  name: string
  size: number
  mtimeMs: number
  ext: string
}

interface Props {
  runId: string
  stageId: string
  stageName: string
  onClose: () => void
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

function relativeTime(ms: number): string {
  const diff = Date.now() - ms
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function fileIcon(ext: string): string {
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico'].includes(ext)) return '🖼'
  if (['json', 'yaml', 'yml', 'toml'].includes(ext)) return '📋'
  if (['md', 'txt', 'log'].includes(ext)) return '📄'
  if (['sh', 'py', 'js', 'ts', 'tsx', 'jsx', 'rb', 'go', 'rs', 'java', 'c', 'cpp'].includes(ext)) return '💻'
  if (['csv', 'sql'].includes(ext)) return '🗃'
  if (['html', 'css', 'xml'].includes(ext)) return '🌐'
  if (['zip', 'tar', 'gz'].includes(ext)) return '📦'
  return '📁'
}

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico'])
const TEXT_EXTS = new Set([
  'txt', 'md', 'json', 'yaml', 'yml', 'csv', 'log', 'sh', 'py', 'js', 'ts',
  'tsx', 'jsx', 'html', 'css', 'xml', 'toml', 'ini', 'env', 'sql', 'rs',
  'go', 'rb', 'php', 'java', 'c', 'cpp', 'h', 'conf', 'nmap', 'out',
])

export function StageArtifactsPanel({ runId, stageId, stageName, onClose }: Props) {
  const [files, setFiles] = useState<ArtifactFile[]>([])
  const [stageDir, setStageDir] = useState('')
  const [loading, setLoading] = useState(true)
  const [selectedFile, setSelectedFile] = useState<ArtifactFile | null>(null)
  const [preview, setPreview] = useState<{ content: string | null; binary?: boolean; imageUrl?: string } | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)

  const loadFiles = useCallback(async () => {
    try {
      setLoading(true)
      const res = await api<{ files: ArtifactFile[]; stageDir: string }>(
        'GET', `/pipeline-runs/${runId}/stages/${stageId}/artifacts`
      )
      setFiles(res.files)
      setStageDir(res.stageDir)
    } catch {
      setFiles([])
    } finally {
      setLoading(false)
    }
  }, [runId, stageId])

  useEffect(() => { loadFiles() }, [loadFiles])

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const openPreview = async (file: ArtifactFile) => {
    setSelectedFile(file)
    setPreview(null)
    setPreviewLoading(true)
    try {
      if (IMAGE_EXTS.has(file.ext)) {
        const imageUrl = `/api/pipeline-runs/${runId}/stages/${stageId}/artifacts/${file.name}`
        setPreview({ content: null, imageUrl })
      } else if (TEXT_EXTS.has(file.ext)) {
        const res = await api<{ content: string | null; binary?: boolean }>(
          'GET', `/pipeline-runs/${runId}/stages/${stageId}/artifacts/${file.name}`
        )
        setPreview(res)
      } else {
        setPreview({ content: null, binary: true })
      }
    } catch {
      setPreview({ content: '(Error loading file)', binary: false })
    } finally {
      setPreviewLoading(false)
    }
  }

  const downloadFile = (filename: string) => {
    window.open(`/api/pipeline-runs/${runId}/stages/${stageId}/artifacts/${filename}?download=1`, '_blank')
  }

  return (
    <div className="fixed inset-y-0 right-0 z-50 flex">
      {/* Overlay */}
      <div className="fixed inset-0 bg-black/40" onClick={onClose} />

      {/* Panel */}
      <div className={`relative ml-auto flex flex-col h-full bg-bg border-l border-white/[0.06] shadow-2xl transition-all ${selectedFile ? 'w-[800px]' : 'w-[400px]'}`}
        style={{ animation: 'slide-in-right 0.25s cubic-bezier(0.16,1,0.3,1)' }}>

        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.06] shrink-0">
          <div className="flex-1 min-w-0">
            <h3 className="font-display text-[14px] font-600 text-text truncate">Stage Artifacts</h3>
            <p className="text-[11px] text-text-3 truncate">{stageName}</p>
          </div>
          <button
            onClick={loadFiles}
            className="p-1.5 rounded-[6px] text-text-3 hover:text-text-2 hover:bg-white/[0.04] transition-all cursor-pointer"
            title="Refresh"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded-[6px] text-text-3 hover:text-text-2 hover:bg-white/[0.04] transition-all cursor-pointer"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="flex flex-1 min-h-0">
          {/* File list */}
          <div className={`flex flex-col ${selectedFile ? 'w-[260px] border-r border-white/[0.06]' : 'flex-1'} overflow-y-auto`}>
            {stageDir && (
              <div className="px-3 py-2 border-b border-white/[0.04]">
                <p className="text-[10px] text-text-3 font-mono break-all leading-relaxed">{stageDir}</p>
              </div>
            )}

            {loading ? (
              <div className="flex items-center justify-center py-12">
                <div className="w-4 h-4 rounded-full border-2 border-accent-bright/30 border-t-accent-bright animate-spin" />
              </div>
            ) : files.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
                <div className="w-8 h-8 rounded-[10px] bg-white/[0.04] flex items-center justify-center mb-2 text-[16px]">📂</div>
                <p className="text-[12px] text-text-3">No files yet</p>
                <p className="text-[11px] text-text-3/60 mt-0.5">Files created by the agent will appear here</p>
              </div>
            ) : (
              <div className="py-1">
                {files.map(file => (
                  <button
                    key={file.name}
                    onClick={() => openPreview(file)}
                    className={`w-full text-left px-3 py-2.5 flex items-start gap-2.5 hover:bg-white/[0.03] transition-all cursor-pointer group ${
                      selectedFile?.name === file.name ? 'bg-accent-soft/20' : ''
                    }`}
                  >
                    <span className="text-[14px] mt-0.5 flex-shrink-0">{fileIcon(file.ext)}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] font-500 text-text-2 truncate">{file.name}</p>
                      <p className="text-[10px] text-text-3">{formatSize(file.size)} · {relativeTime(file.mtimeMs)}</p>
                    </div>
                    <button
                      onClick={e => { e.stopPropagation(); downloadFile(file.name) }}
                      className="p-1 rounded-[5px] text-text-3 opacity-0 group-hover:opacity-100 hover:text-text-2 hover:bg-white/[0.06] transition-all cursor-pointer flex-shrink-0"
                      title="Download"
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
                      </svg>
                    </button>
                  </button>
                ))}
              </div>
            )}

            {files.length > 0 && (
              <div className="mt-auto px-3 py-2.5 border-t border-white/[0.04]">
                <p className="text-[10px] text-text-3">{files.length} file{files.length !== 1 ? 's' : ''}</p>
              </div>
            )}
          </div>

          {/* File preview */}
          {selectedFile && (
            <div className="flex-1 flex flex-col min-w-0 min-h-0">
              {/* Preview header */}
              <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/[0.04] shrink-0">
                <span className="text-[13px]">{fileIcon(selectedFile.ext)}</span>
                <span className="flex-1 text-[12px] font-500 text-text truncate">{selectedFile.name}</span>
                <span className="text-[10px] text-text-3">{formatSize(selectedFile.size)}</span>
                <button
                  onClick={() => downloadFile(selectedFile.name)}
                  className="flex items-center gap-1 px-2 py-1 rounded-[6px] bg-white/[0.04] text-text-3 text-[10px] font-500 hover:bg-white/[0.08] hover:text-text-2 transition-all cursor-pointer"
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  Download
                </button>
                <button onClick={() => { setSelectedFile(null); setPreview(null) }} className="p-1 text-text-3 hover:text-text-2 cursor-pointer">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>

              {/* Preview content */}
              <div className="flex-1 overflow-auto p-4 min-h-0">
                {previewLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <div className="w-4 h-4 rounded-full border-2 border-accent-bright/30 border-t-accent-bright animate-spin" />
                  </div>
                ) : !preview ? null : preview.imageUrl ? (
                  <img src={preview.imageUrl} alt={selectedFile.name} className="max-w-full rounded-[8px]" />
                ) : preview.binary ? (
                  <div className="flex flex-col items-center gap-3 py-12 text-center">
                    <span className="text-[32px]">{fileIcon(selectedFile.ext)}</span>
                    <p className="text-[12px] text-text-3">Binary file — preview not available</p>
                    <button
                      onClick={() => downloadFile(selectedFile.name)}
                      className="px-3 py-1.5 rounded-[8px] bg-accent-bright text-white text-[12px] font-600 cursor-pointer hover:brightness-110 transition-all"
                    >
                      Download File
                    </button>
                  </div>
                ) : (
                  <pre className="text-[11px] text-text-2 leading-relaxed font-mono whitespace-pre-wrap break-words">
                    {preview.content}
                  </pre>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes slide-in-right {
          from { transform: translateX(100%); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
      `}</style>
    </div>
  )
}
