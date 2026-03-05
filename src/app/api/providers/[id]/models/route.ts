import { NextResponse } from 'next/server'
import { loadModelOverrides, saveModelOverrides } from '@/lib/server/storage'
import { notFound } from '@/lib/server/collection-helpers'
import { getProviderList, getProvider } from '@/lib/providers'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const overrides = loadModelOverrides()
  
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
