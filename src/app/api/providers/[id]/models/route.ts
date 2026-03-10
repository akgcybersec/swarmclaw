import { NextResponse } from 'next/server'
import { loadModelOverrides, saveModelOverrides, loadCredentials, decryptKey } from '@/lib/server/storage'
import { notFound } from '@/lib/server/collection-helpers'
import { getProviderList, getProvider } from '@/lib/providers'

async function fetchOpenRouterModels(apiKey?: string): Promise<string[]> {
  try {
    const headers: Record<string, string> = {}
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`
    }
    
    const res = await fetch('https://openrouter.ai/api/v1/models', {
      headers,
      signal: AbortSignal.timeout(10000),
    })
    
    if (!res.ok) {
      console.error('[openrouter] Failed to fetch models:', res.status)
      return []
    }
    
    const data = await res.json()
    if (!data.data || !Array.isArray(data.data)) return []
    
    return data.data
      .map((model: any) => model.id)
      .filter((id: string) => id && typeof id === 'string')
      .sort()
  } catch (err) {
    console.error('[openrouter] Error fetching models:', err)
    return []
  }
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const overrides = loadModelOverrides()
  
  // Special handling for OpenRouter - always fetch from API
  if (id === 'openrouter') {
    // Try to get API key from credentials
    let apiKey: string | undefined
    try {
      const credentials = loadCredentials()
      const openrouterCred = Object.values(credentials).find((c: any) => c.provider === 'openrouter')
      if (openrouterCred && (openrouterCred as any).encryptedKey) {
        apiKey = decryptKey((openrouterCred as any).encryptedKey)
      }
    } catch {
      // No credentials available
    }
    
    // Always try to fetch live models (with or without API key)
    const liveModels = await fetchOpenRouterModels(apiKey)
    if (liveModels.length > 0) {
      return NextResponse.json({ 
        models: liveModels, 
        hasOverride: !!overrides[id],
        live: true,
        modelCount: liveModels.length,
        requiresApiKey: !apiKey
      })
    }
    
    // If no models fetched and no API key, return empty with message
    if (!apiKey) {
      return NextResponse.json({ 
        models: [], 
        hasOverride: !!overrides[id],
        live: false,
        requiresApiKey: true,
        message: 'Configure OpenRouter API key to see available models'
      })
    }
  }
  
  // Try to get provider from the full provider registry (includes OpenClaw)
  const providerFromRegistry = getProvider(id)
  if (providerFromRegistry) {
    return NextResponse.json({ 
      models: overrides[id] || providerFromRegistry.models, 
      hasOverride: !!overrides[id] 
    })
  }
  
  // Fallback to provider list (for custom providers)
  const providers = getProviderList()
  const provider = providers.find((p) => p.id === id)
  if (!provider) return notFound()
  return NextResponse.json({ models: provider.models, hasOverride: !!overrides[id] })
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json()
  const overrides = loadModelOverrides()
  overrides[id] = body.models || []
  saveModelOverrides(overrides)
  return NextResponse.json({ models: overrides[id] })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const overrides = loadModelOverrides()
  delete overrides[id]
  saveModelOverrides(overrides)
  return NextResponse.json({ ok: true })
}
