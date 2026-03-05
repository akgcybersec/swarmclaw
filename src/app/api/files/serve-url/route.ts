import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'

// Store temporary tokens in memory (HMR-safe)
const tokenStore = (
  (globalThis as Record<string, unknown>).__swarmclaw_file_tokens__ ??= new Map()
) as Map<string, { path: string; expiresAt: number }>

const TOKEN_EXPIRY_MS = 5 * 60 * 1000 // 5 minutes

// Clean up expired tokens periodically
function pruneExpiredTokens() {
  const now = Date.now()
  for (const [token, data] of tokenStore.entries()) {
    if (data.expiresAt < now) {
      tokenStore.delete(token)
    }
  }
}

export async function POST(req: NextRequest) {
  try {
    const { path } = await req.json() as { path?: string }
    
    if (!path || typeof path !== 'string') {
      return NextResponse.json({ error: 'path is required' }, { status: 400 })
    }

    // Generate a secure random token
    const token = crypto.randomBytes(32).toString('hex')
    const expiresAt = Date.now() + TOKEN_EXPIRY_MS

    // Store the token with the file path
    tokenStore.set(token, { path, expiresAt })

    // Clean up old tokens
    pruneExpiredTokens()

    // Return the signed URL
    const url = `/api/files/serve?token=${token}`
    return NextResponse.json({ url })
  } catch (error) {
    console.error('[files/serve-url] Error:', error)
    return NextResponse.json({ error: 'Failed to generate URL' }, { status: 500 })
  }
}

export { tokenStore, TOKEN_EXPIRY_MS }
