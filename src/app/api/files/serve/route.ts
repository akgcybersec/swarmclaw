import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

const MIME_MAP: Record<string, string> = {
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.ts': 'text/plain',
  '.tsx': 'text/plain',
  '.jsx': 'text/plain',
  '.py': 'text/plain',
  '.sh': 'text/plain',
  '.pdf': 'application/pdf',
  '.csv': 'text/csv',
  '.xml': 'application/xml',
  '.zip': 'application/zip',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}

const MAX_SIZE = 10 * 1024 * 1024 // 10MB

function serveFile(resolved: string): NextResponse {
  // Block access to sensitive paths
  const blocked = ['.env', 'credentials', '.ssh', '.gnupg', '.aws']
  if (blocked.some((b) => resolved.includes(b))) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  if (!fs.existsSync(resolved)) {
    return NextResponse.json({ error: 'File not found' }, { status: 404 })
  }

  const stat = fs.statSync(resolved)
  if (!stat.isFile()) {
    return NextResponse.json({ error: 'Not a file' }, { status: 400 })
  }
  if (stat.size > MAX_SIZE) {
    return NextResponse.json({ error: 'File too large' }, { status: 413 })
  }

  const ext = path.extname(resolved).toLowerCase()
  const contentType = MIME_MAP[ext] || 'application/octet-stream'
  const content = fs.readFileSync(resolved)

  return new NextResponse(content, {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': contentType.startsWith('text/') || contentType.startsWith('image/')
        ? 'inline'
        : `attachment; filename="${path.basename(resolved)}"`,
    },
  })
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const token = url.searchParams.get('token')
  const filePath = url.searchParams.get('path')

  // Token-based access (secure, time-limited)
  if (token) {
    const { tokenStore } = await import('../serve-url/route')
    const tokenData = tokenStore.get(token)
    
    if (!tokenData) {
      return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 })
    }

    if (tokenData.expiresAt < Date.now()) {
      tokenStore.delete(token)
      return NextResponse.json({ error: 'Token expired' }, { status: 401 })
    }

    // Use the path from the token (prevents path manipulation)
    const resolvedPath = path.resolve(tokenData.path)
    
    // Delete token after first use (one-time use)
    tokenStore.delete(token)
    
    return serveFile(resolvedPath)
  }

  // Legacy path-based access (kept for backward compatibility, but requires auth middleware)
  if (!filePath) {
    return NextResponse.json({ error: 'Missing path or token parameter' }, { status: 400 })
  }

  const resolved = path.resolve(filePath)
  return serveFile(resolved)
}
