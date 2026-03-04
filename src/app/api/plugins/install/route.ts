import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { validateAccessKey } from '@/lib/server/storage'

const PLUGINS_DIR = path.join(process.cwd(), 'data', 'plugins')

export async function POST(req: Request) {
  // Validate authentication
  const accessKey = req.headers.get('X-Access-Key')
  if (!validateAccessKey(accessKey || '')) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 },
    )
  }

  const body = await req.json()
  const { url, filename } = body

  // Validate URL
  if (!url || typeof url !== 'string' || !url.startsWith('https://')) {
    return NextResponse.json(
      { error: 'URL must be a valid HTTPS URL' },
      { status: 400 },
    )
  }

  // Validate filename
  if (!filename || typeof filename !== 'string' || !filename.endsWith('.js')) {
    return NextResponse.json(
      { error: 'Filename must end in .js' },
      { status: 400 },
    )
  }

  // Path traversal protection
  const sanitized = path.basename(filename)
  if (sanitized !== filename || filename.includes('..')) {
    return NextResponse.json(
      { error: 'Invalid filename' },
      { status: 400 },
    )
  }

  try {
    const res = await fetch(url)
    if (!res.ok) {
      throw new Error(`Download failed: ${res.status}`)
    }
    const code = await res.text()

    // Ensure plugins directory exists
    if (!fs.existsSync(PLUGINS_DIR)) {
      fs.mkdirSync(PLUGINS_DIR, { recursive: true })
    }

    const dest = path.join(PLUGINS_DIR, sanitized)
    fs.writeFileSync(dest, code, 'utf8')

    return NextResponse.json({ ok: true, filename: sanitized })
  } catch (err: unknown) {
    return NextResponse.json(
      { error: 'Failed to install plugin', message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
