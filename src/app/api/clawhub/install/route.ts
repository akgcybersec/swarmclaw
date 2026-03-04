import { NextResponse } from 'next/server'
import { genId } from '@/lib/id'
import { loadSkills, saveSkills } from '@/lib/server/storage'
import { fetchSkillContent } from '@/lib/server/clawhub-client'

export async function POST(req: Request) {
  const body = await req.json()
  const { name, description, url, author, tags, owner, slug } = body
  let { content } = body

  if (!content && slug && owner) {
    try {
      content = await fetchSkillContent(slug, owner)
    } catch (err: any) {
      // Don't fail the installation, just log the error and use fallback
      console.warn(`Failed to fetch skill content for ${slug}/${owner}:`, err.message)
      content = `# ${slug}

## Description
Skill from ClawHub repository.

## Author
${owner}

## Installation
This skill was automatically installed from ClawHub.

## Usage
Configure this skill in your agent settings to enable its functionality.

*Note: Full skill content was not available from the source repository.*`
    }
  }

  const skills = loadSkills()
  const id = genId()
  skills[id] = {
    id,
    name,
    filename: `skill-${id}.md`,
    content,
    description: description || '',
    sourceFormat: 'openclaw',
    sourceUrl: url,
    author: author || '',
    tags: tags || [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  saveSkills(skills)
  return NextResponse.json(skills[id])
}
