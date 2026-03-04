import type { NextConfig } from "next";
import { execSync } from "child_process";

function getGitSha(): string {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim()
  } catch {
    return 'unknown'
  }
}

const nextConfig: NextConfig = {
  output: 'standalone',
  turbopack: {
    // Pin workspace root to the project directory so a stale lockfile
    // in a parent folder (e.g. ~/) doesn't confuse native module resolution.
    root: process.cwd(),
  },
  experimental: {
    // Disable Turbopack persistent cache — concurrent HMR writes cause
    // "Another write batch or compaction is already active" errors
    turbopackFileSystemCacheForDev: false,
  },
  env: {
    NEXT_PUBLIC_GIT_SHA: getGitSha(),
    NEXT_PUBLIC_WS_PORT: String((Number(process.env.PORT) || 3456) + 1),
  },
  // Allow external network access
  serverExternalPackages: [
    'ws',
    'highlight.js', 'better-sqlite3',
    'discord.js', '@discordjs/ws', '@discordjs/rest',
    'grammy',
    '@slack/bolt', '@slack/web-api', '@slack/socket-mode',
    '@whiskeysockets/baileys',
    'qrcode',
  ],
  allowedDevOrigins: [
    'localhost',
    '127.0.0.1',
    '0.0.0.0',
    'openclaw.lan',
  ],
  async rewrites() {
    const views = 'agents|chatrooms|schedules|memory|tasks|secrets|providers|skills|connectors|webhooks|mcp-servers|knowledge|plugins|usage|runs|logs|settings|projects|activity'
    return [
      {
        source: `/:view(${views})`,
        destination: '/',
      },
      {
        source: `/:view(${views})/:id`,
        destination: '/',
      },
    ]
  },
};

export default nextConfig;
