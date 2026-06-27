import type { AiSettings, NovelProject } from './types'

const PROJECT_KEY = 'novel-forge-project-v2'
const SETTINGS_KEY = 'novel-forge-settings-v1'

export function loadProject(): NovelProject | null {
  const raw = localStorage.getItem(PROJECT_KEY)
  return raw ? migrateProject(JSON.parse(raw) as NovelProject) : null
}

export function saveProject(project: NovelProject) {
  localStorage.setItem(PROJECT_KEY, JSON.stringify(migrateProject(project)))
}

export function loadSettings(): AiSettings {
  const defaults: AiSettings = {
    endpoint: 'https://api.deepseek.com',
    apiKey: '',
    model: 'deepseek-v4-flash',
    contextMode: 'full',
    cacheEnabled: true,
  }
  const raw = localStorage.getItem(SETTINGS_KEY)
  if (!raw) return defaults
  const saved = JSON.parse(raw) as Partial<AiSettings> & { mode?: unknown }
  if (String(saved.mode || '') === 'openai-compatible' || saved.endpoint?.includes('openai.com')) {
    return { ...defaults, apiKey: saved.apiKey || '' }
  }
  return { ...defaults, ...saved }
}

export function saveSettings(settings: AiSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
}

export function migrateProject(project: NovelProject): NovelProject {
  return {
    ...project,
    timelineEvents: Array.isArray(project.timelineEvents) ? project.timelineEvents : [],
  }
}
