export type Tone = '热血爽文' | '悬疑克制' | '轻喜群像' | '史诗厚重'

export interface Character {
  id: string
  name: string
  role: string
  desire: string
  secret: string
  status: string
}

export interface WorldItem {
  id: string
  name: string
  category: string
  rule: string
}

export interface Foreshadowing {
  id: string
  title: string
  plantedIn: number
  payoffBy: number
  status: '未埋设' | '已埋设' | '回收中' | '已回收'
}

export interface Chapter {
  id: string
  number: number
  title: string
  goal: string
  outline: string
  draft: string
  summary: string
  issues: string[]
  updatedAt: string
}

export interface TimelineEvent {
  id: string
  chapterNumber: number
  title: string
  detail: string
}

export interface NovelProject {
  id: string
  title: string
  genre: string
  audience: string
  targetWords: number
  chapterCount: number
  tone: Tone
  premise: string
  logline: string
  sellingPoints: string[]
  globalMemory: string
  characters: Character[]
  worldItems: WorldItem[]
  foreshadowings: Foreshadowing[]
  timelineEvents: TimelineEvent[]
  chapters: Chapter[]
}

export interface AiSettings {
  endpoint: string
  apiKey: string
  model: string
  contextMode: 'full' | 'smart'
  cacheEnabled: boolean
}
