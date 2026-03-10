import { NextResponse } from 'next/server'
import { genId } from '@/lib/id'
import { getProviderList } from '@/lib/providers'
import { loadProviderConfigs, saveProviderConfigs, loadCredentials, decryptKey } from '@/lib/server/storage'
import { notify } from '@/lib/server/ws-hub'
export const dynamic = 'force-dynamic'

async function fetchOpenRouterModelsForProviders(): Promise<string[]> {
  try {
    const credentials = loadCredentials()
    const openrouterCred = Object.values(credentials).find((c: any) => c.provider === 'openrouter')
    let apiKey: string | undefined
    if (openrouterCred && (openrouterCred as any).encryptedKey) {
      apiKey = decryptKey((openrouterCred as any).encryptedKey)
    }
    
    if (!apiKey) return []
    
    const res = await fetch('https://openrouter.ai/api/v1/models', {
      headers: { 'Authorization': `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(5000),
    })
    
    if (!res.ok) return []
    const data = await res.json()
    if (!data.data || !Array.isArray(data.data)) return []
    
    return data.data
      .map((model: any) => model.id)
      .filter((id: string) => id && typeof id === 'string')
      .sort()
  } catch {
    return []
  }
}

export async function GET(_req: Request) {
  const providers = getProviderList()
  
  // Special handling for OpenRouter - fetch live models
  const openrouterProvider = providers.find(p => p.id === 'openrouter')
  if (openrouterProvider) {
    const liveModels = await fetchOpenRouterModelsForProviders()
    if (liveModels.length > 0) {
      // Update the OpenRouter provider with live models
      const updatedProviders = providers.map(p => 
        p.id === 'openrouter' 
          ? { ...p, models: liveModels }
          : p
      )
      return NextResponse.json(updatedProviders)
    }
  }
  
  return NextResponse.json(providers)
}

export async function POST(req: Request) {
  const body = await req.json()
  const configs = loadProviderConfigs()
  const id = body.id || `custom-${genId()}`
  configs[id] = {
    id,
    name: body.name || 'Custom Provider',
    type: 'custom',
    baseUrl: body.baseUrl || '',
    models: body.models || [],
    requiresApiKey: body.requiresApiKey ?? true,
    credentialId: body.credentialId || null,
    isEnabled: body.isEnabled ?? true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  saveProviderConfigs(configs)
  notify('providers')
  return NextResponse.json(configs[id])
}
