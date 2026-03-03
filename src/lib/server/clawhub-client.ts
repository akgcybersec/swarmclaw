import type { ClawHubSkill } from '@/types'

export interface ClawHubSearchResult {
  skills: ClawHubSkill[]
  total: number
  page: number
}

const CLAWHUB_BASE_URL = process.env.CLAWHUB_API_URL || 'https://clawhub.ai/api/v1'

export async function searchClawHub(query: string, page = 1, limit = 20): Promise<ClawHubSearchResult> {
  try {
    const url = `${CLAWHUB_BASE_URL}/skills?q=${encodeURIComponent(query)}&limit=${limit}`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`ClawHub responded with ${res.status}`)
    const data = await res.json()
    
    // Transform the new API format to SwarmClaw's expected format
    const skills: ClawHubSkill[] = (data.items || []).map((item: any) => ({
      id: item.slug,
      name: item.displayName,
      description: item.summary,
      author: item.owner?.handle || item.metadata?.author || 'Community',
      tags: Object.keys(item.tags || {}),
      downloads: item.stats?.downloads || 0,
      url: `https://clawhub.ai/skills/${item.slug}`,
      version: item.latestVersion?.version || '1.0.0',
      owner: item.owner?.handle || 'unknown' // Add owner for GitHub fetching
    }))
    
    return {
      skills,
      total: skills.length, // The new API doesn't provide total count
      page
    }
  } catch {
    return { skills: [], total: 0, page }
  }
}

export async function fetchSkillContent(slug: string, owner: string): Promise<string> {
  // Try GitHub first
  const githubUrl = `https://raw.githubusercontent.com/${owner}/${slug}/main/SKILL.md`
  try {
    const res = await fetch(githubUrl)
    if (res.ok) {
      return res.text()
    }
  } catch {
    // GitHub fetch failed, continue to fallback
  }

  // Try README.md
  try {
    const readmeUrl = `https://raw.githubusercontent.com/${owner}/${slug}/main/README.md`
    const readmeRes = await fetch(readmeUrl)
    if (readmeRes.ok) {
      return readmeRes.text()
    }
  } catch {
    // README fetch failed, continue to fallback
  }

  // Fallback: Create basic skill content from ClawHub data
  return `# ${slug}

## Description
Skill from ClawHub repository.

## Author
${owner}

## Installation
This skill was automatically installed from ClawHub.

## Usage
Configure this skill in your agent settings to enable its functionality.

*Note: Full skill content was not available from the source repository. This is a basic template.*`
}
