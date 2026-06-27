import type { AiSettings, Chapter, Character, Foreshadowing, NovelProject, TimelineEvent, WorldItem } from './types'

function id(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`
}

export function createBlankProject(seed: Partial<NovelProject>): NovelProject {
  const chapterCount = seed.chapterCount || 30
  const now = new Date().toISOString()

  return {
    id: id('novel'),
    title: seed.title?.trim() || '等待 AI 生成项目',
    genre: seed.genre?.trim() || '未设定类型',
    audience: seed.audience?.trim() || '未设定读者',
    targetWords: seed.targetWords || 120000,
    chapterCount,
    tone: seed.tone || '悬疑克制',
    premise: seed.premise?.trim() || '',
    logline: '填写项目种子和 DeepSeek Key 后，点击“AI 生成新项目”。',
    sellingPoints: ['等待 AI 生成卖点'],
    globalMemory: '等待 AI 生成项目圣经。',
    characters: [],
    worldItems: [],
    foreshadowings: [],
    timelineEvents: [],
    chapters: Array.from({ length: chapterCount }, (_, index) => ({
      id: id('chapter'),
      number: index + 1,
      title: `第 ${index + 1} 章 待 AI 生成`,
      goal: '等待 AI 生成章节目标。',
      outline: '等待 AI 生成场景纲。',
      draft: '',
      summary: '',
      issues: [],
      updatedAt: now,
    })),
  }
}

export async function createProjectWithDeepSeek(
  seed: Partial<NovelProject>,
  settings: AiSettings,
): Promise<NovelProject> {
  ensureApiKey(settings)
  const fallback = createBlankProject(seed)
  const parsed = await requestDeepSeekPromptJson(
    settings,
    buildProjectPrompt(fallback),
    '你是中文长篇小说策划 Agent，负责生成可持续写作的小说项目圣经。',
  )
  return mergeProjectPlan(fallback, parsed)
}

export async function refreshChapterPlanWithDeepSeek(
  project: NovelProject,
  settings: AiSettings,
): Promise<NovelProject> {
  ensureApiKey(settings)
  const prompt = `
请为这部长篇小说重新生成不重复的章节流水线。

要求：
1. 输出 JSON，不要 Markdown，不要代码块。
2. JSON 字段 chapters 是数组，长度必须是 ${project.chapterCount}。
3. 每个 chapters 元素包含 number、title、goal、outline。
4. title 必须短、有辨识度、随剧情递进，不能循环复用同一批词。
5. goal 要说明本章产生的不可逆变化。
6. outline 要包含开场/中段/结尾三个推进点。
7. 不要覆盖已有正文，只负责规划。

小说：${project.title}
类型：${project.genre}
文风：${project.tone}
核心前提：${project.premise}
现有人物：
${project.characters.map((item) => `- ${item.name}：${item.role}，${item.status}`).join('\n') || '暂无'}
世界规则：
${project.worldItems.map((item) => `- ${item.name}：${item.rule}`).join('\n') || '暂无'}
伏笔：
${project.foreshadowings.map((item) => `- ${item.title}：第${item.plantedIn}章埋设，第${item.payoffBy}章回收`).join('\n') || '暂无'}
`.trim()

  const parsed = await requestDeepSeekPromptJson(settings, prompt, '你是长篇小说结构编辑，擅长三幕式和网文章节节奏。')
  return mergeChapterPlan(project, parsed)
}

export async function generateChapterWithDeepSeek(
  project: NovelProject,
  chapterId: string,
  settings: AiSettings,
): Promise<NovelProject> {
  ensureApiKey(settings)
  const chapter = project.chapters.find((item) => item.id === chapterId)
  if (!chapter) return project

  const messages = buildChapterGenerationMessages(project, chapter, settings)

  const targetLength = getChapterTargetLength(project)
  const parsed = await requestDeepSeekMessagesJson(settings, messages, 12000)
  let draft = text(parsed.draft, '')
  let summary = text(parsed.summary, `第${chapter.number}章已生成，需要人工补充摘要。`)

  for (let attempt = 0; attempt < 2 && countChineseText(draft) < targetLength * 0.9; attempt += 1) {
    const continuation = await continueChapterWithDeepSeek(project, chapter, draft, targetLength, settings)
    draft = joinDraftParts(draft, text(continuation.draftContinuation, text(continuation.draft, '')))
    summary = text(continuation.summary, summary)
  }
  const issues = checkChapter(project, { ...chapter, draft, summary })
  const timelineEvents = normalizeTimelineEvents(parsed.timelineEvents, chapter.number)
  const characterUpdates = normalizeCharacters(parsed.characterUpdates)
  const worldItemUpdates = normalizeWorldItems(parsed.worldItemUpdates)
  const foreshadowingUpdates = normalizeForeshadowings(parsed.foreshadowingUpdates, project.chapterCount)

  return {
    ...project,
    chapters: project.chapters.map((item) =>
      item.id === chapterId ? { ...item, draft, summary, issues, updatedAt: new Date().toISOString() } : item,
    ),
    characters: characterUpdates.length ? mergeByName(project.characters, characterUpdates) : updateLeadCharacter(project.characters, chapter.number, summary),
    worldItems: worldItemUpdates.length ? mergeWorldItems(project.worldItems, worldItemUpdates) : project.worldItems,
    foreshadowings: foreshadowingUpdates.length
      ? mergeForeshadowings(project.foreshadowings, foreshadowingUpdates)
      : advanceForeshadowings(project.foreshadowings, chapter.number),
    timelineEvents: mergeTimelineEvents(project.timelineEvents, timelineEvents),
    globalMemory: `${project.globalMemory}\n${summary}`.trim(),
  }
}

export async function auditChapterConsistencyWithDeepSeek(
  project: NovelProject,
  chapterId: string,
  settings: AiSettings,
): Promise<NovelProject> {
  ensureApiKey(settings)
  const chapter = project.chapters.find((item) => item.id === chapterId)
  if (!chapter) return project
  if (!chapter.draft.trim()) {
    return updateChapterIssues(project, chapterId, ['还没有正文，无法进行冲突审校。'])
  }

  const previousFacts = project.chapters
    .filter((item) => item.number < chapter.number && (item.summary || item.draft))
    .map((item) => `第${item.number}章 ${item.title}\n摘要：${item.summary || '暂无摘要'}`)
    .join('\n\n')

  const futurePlan = project.chapters
    .filter((item) => item.number > chapter.number)
    .slice(0, 6)
    .map((item) => `第${item.number}章：${item.title}｜${item.goal}`)
    .join('\n')

  const prompt = `
请审校当前章节是否与已有设定或前文发生冲突。

要求：
1. 输出 JSON，不要 Markdown，不要代码块。
2. JSON 字段：issues。
3. issues 是字符串数组；如果没有冲突，返回 ["未发现明确连续性冲突。"]。
4. 重点检查：
   - 人物身份、动机、关系、伤势、生死状态是否前后矛盾。
   - 时间线、地点移动、物品归属、能力规则是否互相打架。
   - 已埋伏笔是否被误回收、重复回收或遗忘。
   - 当前章是否推翻前文事实却没有解释。
   - 当前章是否破坏后续章节计划。
5. 不要把“可以后续解释的悬念”误判为冲突；只指出真正需要作者处理的问题。

项目上下文：
${buildProjectContext(project)}

前文事实：
${previousFacts || '暂无前文。'}

后续计划：
${futurePlan || '暂无后续计划。'}

当前章节：
标题：${chapter.title}
目标：${chapter.goal}
场景纲：${chapter.outline}
正文：
${chapter.draft}
`.trim()

  const parsed = await requestDeepSeekPromptJson(settings, prompt, '你是长篇小说连续性审校员，专门发现人物、时间线、设定和伏笔冲突。')
  const issues = toArray<unknown>(parsed.issues)
    .map((item) => text(item, ''))
    .filter(Boolean)
  return updateChapterIssues(project, chapterId, issues.length ? issues : ['未发现明确连续性冲突。'])
}

export async function compactMemoryWithDeepSeek(project: NovelProject, settings: AiSettings): Promise<NovelProject> {
  ensureApiKey(settings)
  const recentChapters = project.chapters
    .filter((chapter) => chapter.summary || chapter.draft)
    .slice(-8)
    .map((chapter) => `第${chapter.number}章 ${chapter.title}\n摘要：${chapter.summary || '暂无摘要'}`)
    .join('\n\n')

  const prompt = `
请作为长篇小说 Librarian 整理当前项目记忆。

要求：
1. 输出 JSON，不要 Markdown，不要代码块。
2. 顶层字段：globalMemory、characters、worldItems、foreshadowings、timelineEvents。
3. globalMemory 压缩为 600-1000 字，保留已发生事实、核心冲突、未解决问题。
4. characters 保留全部重要人物，每个包含 name、role、desire、secret、status。
5. worldItems 保留重要设定，每个包含 name、category、rule。
6. foreshadowings 保留未回收或重要伏笔，每个包含 title、plantedIn、payoffBy、status。
7. timelineEvents 保留已经发生或计划中的关键事件，每个包含 chapterNumber、title、detail。
8. 不要编造已完成正文中没有依据的重大事实，可以提出“待确认”状态。

当前项目：
${buildProjectContext(project)}

最近章节：
${recentChapters || '暂无已生成章节。'}
`.trim()

  const parsed = await requestDeepSeekPromptJson(settings, prompt, '你是长篇小说记忆管理员，负责压缩连续性、人物状态和伏笔表。')
  return {
    ...project,
    globalMemory: text(parsed.globalMemory, project.globalMemory),
    characters: mergeByName(project.characters, normalizeCharacters(parsed.characters)),
    worldItems: mergeWorldItems(project.worldItems, normalizeWorldItems(parsed.worldItems)),
    foreshadowings: mergeForeshadowings(project.foreshadowings, normalizeForeshadowings(parsed.foreshadowings, project.chapterCount)),
    timelineEvents: mergeTimelineEvents(project.timelineEvents, normalizeTimelineEvents(parsed.timelineEvents, 1)),
  }
}

export function buildChapterContextPreview(
  project: NovelProject,
  chapter: Chapter | undefined,
  mode: AiSettings['contextMode'] = 'full',
) {
  if (!chapter) return '暂无章节。'
  return buildChapterContext(project, chapter, mode)
}

async function requestDeepSeekPromptJson(settings: AiSettings, prompt: string, system: string): Promise<Record<string, unknown>> {
  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: prompt },
  ]
  return requestDeepSeekMessagesJson(settings, messages, 12000)
}

async function requestDeepSeekMessagesJson(
  settings: AiSettings,
  messages: Array<{ role: string; content: string }>,
  maxTokens: number,
): Promise<Record<string, unknown>> {
  const response = await fetch('/api/deepseek/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      endpoint: settings.endpoint,
      apiKey: settings.apiKey,
      model: settings.model,
      cacheEnabled: settings.cacheEnabled,
      maxTokens,
      thinking: false,
      messages,
    }),
  })

  if (!response.ok) {
    const data = await response.json().catch(() => null)
    throw new Error(data?.error || `DeepSeek 请求失败：${response.status}`)
  }

  const data = await response.json()
  return parseJsonContent(String(data.content || ''))
}

function buildProjectPrompt(project: NovelProject) {
  return `
请根据用户输入生成一个中文长篇小说项目圣经和章节流水线。

要求：
1. 输出 JSON，不要 Markdown，不要代码块。
2. JSON 顶层字段：title、genre、audience、premise、logline、sellingPoints、characters、worldItems、foreshadowings、timelineEvents、chapters、globalMemory。
3. characters 至少 4 个，每个包含 name、role、desire、secret、status。
4. worldItems 至少 5 个，每个包含 name、category、rule。
5. foreshadowings 至少 5 个，每个包含 title、plantedIn、payoffBy、status，status 使用“未埋设”。
6. chapters 长度必须是 ${project.chapterCount}，每章包含 number、title、goal、outline。
7. 章节标题必须随剧情递进，不能重复套用同一批固定词。
8. 章节目标要体现不可逆变化，outline 要有开场/中段/结尾。
9. timelineEvents 是初始计划时间线，至少 5 条，每条包含 chapterNumber、title、detail。

用户输入：
书名：${project.title}
类型：${project.genre}
受众：${project.audience}
文风：${project.tone}
目标字数：${project.targetWords}
章节数：${project.chapterCount}
核心创意：${project.premise || '用户尚未填写，请生成一个强钩子的原创前提。'}
`.trim()
}

function mergeProjectPlan(fallback: NovelProject, raw: Record<string, unknown>): NovelProject {
  const sellingPoints = toArray<unknown>(raw.sellingPoints)
    .map((item) => text(item, ''))
    .filter(Boolean)
    .slice(0, 6)

  return {
    ...fallback,
    title: text(raw.title, fallback.title),
    genre: text(raw.genre, fallback.genre),
    audience: text(raw.audience, fallback.audience),
    premise: text(raw.premise, fallback.premise),
    logline: text(raw.logline, fallback.logline),
    sellingPoints: sellingPoints.length ? sellingPoints : fallback.sellingPoints,
    globalMemory: text(raw.globalMemory, fallback.globalMemory),
    characters: normalizeCharacters(raw.characters),
    worldItems: normalizeWorldItems(raw.worldItems),
    foreshadowings: normalizeForeshadowings(raw.foreshadowings, fallback.chapterCount),
    timelineEvents: normalizeTimelineEvents(raw.timelineEvents, 1),
    chapters: normalizeAiChapters(raw.chapters, fallback.chapters),
  }
}

function mergeChapterPlan(project: NovelProject, raw: Record<string, unknown>): NovelProject {
  return {
    ...project,
    chapters: normalizeAiChapters(raw.chapters, project.chapters),
  }
}

function updateChapterIssues(project: NovelProject, chapterId: string, issues: string[]): NovelProject {
  return {
    ...project,
    chapters: project.chapters.map((item) =>
      item.id === chapterId ? { ...item, issues, updatedAt: new Date().toISOString() } : item,
    ),
  }
}

function buildProjectContext(project: NovelProject) {
  return `
小说：${project.title}
类型：${project.genre}
受众：${project.audience}
文风：${project.tone}
核心前提：${project.premise}
全局记忆：${project.globalMemory}

人物：
${project.characters.map((item) => `- ${item.name}｜${item.role}｜欲望：${item.desire}｜秘密：${item.secret}｜状态：${item.status}`).join('\n') || '暂无'}

世界观：
${project.worldItems.map((item) => `- ${item.category}：${item.name}｜${item.rule}`).join('\n') || '暂无'}

伏笔：
${project.foreshadowings.map((item) => `- ${item.title}｜埋设 ${item.plantedIn}｜回收 ${item.payoffBy}｜${item.status}`).join('\n') || '暂无'}

时间线：
${project.timelineEvents.map((item) => `- 第${item.chapterNumber}章｜${item.title}｜${item.detail}`).join('\n') || '暂无'}
`.trim()
}

function buildChapterGenerationMessages(project: NovelProject, chapter: Chapter, settings: AiSettings) {
  const targetLength = getChapterTargetLength(project)
  return [
    {
      role: 'system',
      content: '你是严谨的中文长篇小说创作 Agent，擅长保持设定一致性。输出必须是 JSON。',
    },
    {
      role: 'user',
      content: buildStableNovelContext(project, settings.contextMode),
    },
    {
      role: 'user',
      content: `
请基于上一条“稳定小说上下文”生成当前章节草稿。

要求：
1. 输出 JSON，不要 Markdown，不要代码块。
2. JSON 字段必须有 draft 和 summary；可以附加 characterUpdates、worldItemUpdates、foreshadowingUpdates、timelineEvents。
3. draft 写成中文小说正文，目标 ${targetLength} 个中文字符，最低不得少于 ${Math.round(targetLength * 0.9)} 字。必须完整展开场景、动作、对白、心理和环境，不要用摘要式叙述压缩篇幅。
4. summary 用 1-2 句话概括本章发生的不可逆变化。
5. 严格遵守人物状态、世界规则和伏笔安排。
6. 不得推翻已生成章节中已经确定的事实；如果当前目标需要反转，必须在正文中给出合理解释或代价。
7. timelineEvents 至少给 1-3 条本章发生的关键事件，每条包含 chapterNumber、title、detail。
8. 如果人物状态、世界规则或伏笔状态发生变化，请在对应 updates 字段返回完整条目。

当前章节：
标题：${chapter.title}
章节目标：${chapter.goal}
场景纲：${chapter.outline}
`.trim(),
    },
  ]
}

async function continueChapterWithDeepSeek(
  project: NovelProject,
  chapter: Chapter,
  currentDraft: string,
  targetLength: number,
  settings: AiSettings,
) {
  const currentLength = countChineseText(currentDraft)
  const missing = Math.max(targetLength - currentLength, 800)
  const messages = [
    {
      role: 'system',
      content: '你是中文长篇小说续写编辑。输出必须是 JSON，不得复述已经给出的正文。',
    },
    {
      role: 'user',
      content: buildStableNovelContext(project, settings.contextMode),
    },
    {
      role: 'user',
      content: `
当前章节正文只有约 ${currentLength} 字，目标约 ${targetLength} 字，还需要补充至少 ${missing} 字。

请从现有正文最后一句之后无缝续写，补充场景细节、人物行动、对话、心理变化和冲突推进。不要重复已有段落，不要另起章节，不要解释任务。

输出 JSON：
{
  "draftContinuation": "只放新增正文",
  "summary": "合并全文后的章节摘要"
}

章节：${chapter.title}
目标：${chapter.goal}
场景纲：${chapter.outline}

现有正文：
${currentDraft}
`.trim(),
    },
  ]
  return requestDeepSeekMessagesJson(settings, messages, 10000)
}

function getChapterTargetLength(project: NovelProject) {
  return Math.min(Math.max(Math.round(project.targetWords / Math.max(project.chapterCount, 1)), 3000), 6000)
}

function countChineseText(value: string) {
  return value.replace(/\s/g, '').length
}

function joinDraftParts(base: string, continuation: string) {
  if (!continuation.trim()) return base
  const cleanContinuation = continuation.trim()
  if (base.includes(cleanContinuation)) return base
  return `${base.trim()}\n\n${cleanContinuation}`.trim()
}

function buildStableNovelContext(project: NovelProject, mode: AiSettings['contextMode']) {
  const chapterContext =
    mode === 'full'
      ? project.chapters
          .filter((chapter) => chapter.draft || chapter.summary)
          .map((chapter) =>
            [
              `## 第${chapter.number}章 ${chapter.title}`,
              chapter.summary ? `摘要：${chapter.summary}` : '',
              chapter.draft ? `正文：\n${chapter.draft}` : '',
            ]
              .filter(Boolean)
              .join('\n'),
          )
          .join('\n\n')
      : project.chapters
          .filter((chapter) => chapter.summary)
          .slice(-12)
          .map((chapter) => `第${chapter.number}章 ${chapter.title}\n摘要：${chapter.summary}`)
          .join('\n\n')

  return `
【稳定小说上下文】
上下文模式：${mode === 'full' ? '全文上下文，包含已生成章节正文。' : '智能上下文，包含最近章节摘要。'}

${buildProjectContext(project)}

【已生成章节资料】
${chapterContext || '暂无已生成章节。'}
`.trim()
}

function buildChapterContext(project: NovelProject, chapter: Chapter, mode: AiSettings['contextMode']) {
  return `
${buildStableNovelContext(project, mode)}

【当前章节】
标题：${chapter.title}
章节目标：${chapter.goal}
场景纲：${chapter.outline}
`.trim()
}

function normalizeAiChapters(raw: unknown, existing: Chapter[]): Chapter[] {
  const items = toArray<Record<string, unknown>>(raw)
  if (!items.length) return existing
  return existing.map((chapter, index) => {
    const item = items.find((candidate) => numberValue(candidate.number, -1) === chapter.number) || items[index]
    if (!item) return chapter
    const title = text(item.title, chapter.title.replace(/^第 \d+ 章 /, ''))
    return {
      ...chapter,
      title: title.startsWith('第 ') ? title : `第 ${chapter.number} 章 ${title}`,
      goal: text(item.goal, chapter.goal),
      outline: text(item.outline, chapter.outline),
      updatedAt: new Date().toISOString(),
    }
  })
}

function normalizeCharacters(raw: unknown): Character[] {
  return toArray<Record<string, unknown>>(raw).map((item) => ({
    id: id('char'),
    name: text(item.name, '未命名角色'),
    role: text(item.role, '角色'),
    desire: text(item.desire, '待补充欲望'),
    secret: text(item.secret, '待补充秘密'),
    status: text(item.status, '等待登场'),
  }))
}

function normalizeWorldItems(raw: unknown): WorldItem[] {
  return toArray<Record<string, unknown>>(raw).map((item) => ({
    id: id('world'),
    name: text(item.name, '未命名设定'),
    category: text(item.category, '设定'),
    rule: text(item.rule, '待补充规则'),
  }))
}

function normalizeForeshadowings(raw: unknown, chapterCount: number): Foreshadowing[] {
  return toArray<Record<string, unknown>>(raw).map((item) => ({
    id: id('foreshadow'),
    title: text(item.title, '未命名伏笔'),
    plantedIn: clampChapter(numberValue(item.plantedIn, 1), chapterCount),
    payoffBy: clampChapter(numberValue(item.payoffBy, Math.min(chapterCount, 8)), chapterCount),
    status: normalizeForeshadowStatus(item.status),
  }))
}

function normalizeTimelineEvents(raw: unknown, fallbackChapterNumber: number): TimelineEvent[] {
  return toArray<Record<string, unknown>>(raw).map((item) => ({
    id: id('event'),
    chapterNumber: numberValue(item.chapterNumber, fallbackChapterNumber),
    title: text(item.title, '未命名事件'),
    detail: text(item.detail, '待补充事件详情'),
  }))
}

function mergeByName(existing: Character[], incoming: Character[]) {
  if (!incoming.length) return existing
  return incoming.map((item) => ({ ...item, id: existing.find((old) => old.name === item.name)?.id || item.id }))
}

function mergeWorldItems(existing: WorldItem[], incoming: WorldItem[]) {
  if (!incoming.length) return existing
  return incoming.map((item) => ({ ...item, id: existing.find((old) => old.name === item.name)?.id || item.id }))
}

function mergeForeshadowings(existing: Foreshadowing[], incoming: Foreshadowing[]) {
  if (!incoming.length) return existing
  return incoming.map((item) => ({ ...item, id: existing.find((old) => old.title === item.title)?.id || item.id }))
}

function mergeTimelineEvents(existing: TimelineEvent[], incoming: TimelineEvent[]) {
  if (!incoming.length) return existing
  const kept = existing.filter(
    (old) => !incoming.some((item) => item.chapterNumber === old.chapterNumber && item.title === old.title),
  )
  return [...kept, ...incoming].sort((a, b) => a.chapterNumber - b.chapterNumber)
}

function updateLeadCharacter(characters: Character[], chapterNumber: number, summary: string) {
  return characters.map((item, index) => (index === 0 ? { ...item, status: `第${chapterNumber}章后：${summary}` } : item))
}

function advanceForeshadowings(items: Foreshadowing[], chapterNumber: number) {
  return items.map((item) => {
    if (item.plantedIn <= chapterNumber && item.status === '未埋设') return { ...item, status: '已埋设' as const }
    if (item.payoffBy <= chapterNumber && item.status === '已埋设') return { ...item, status: '回收中' as const }
    return item
  })
}

function parseJsonContent(content: string): Record<string, unknown> {
  const cleaned = content
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim()
  const objectText = cleaned.match(/\{[\s\S]*\}/)?.[0] || cleaned

  try {
    return JSON.parse(objectText)
  } catch {
    const repaired = repairJsonStringLiterals(objectText)
    try {
      return JSON.parse(repaired)
    } catch {
      return extractLooseJsonFields(cleaned)
    }
  }
}

function repairJsonStringLiterals(input: string) {
  let output = ''
  let inString = false
  let escaped = false

  for (const char of input) {
    if (escaped) {
      output += char
      escaped = false
      continue
    }

    if (char === '\\') {
      output += char
      escaped = true
      continue
    }

    if (char === '"') {
      output += char
      inString = !inString
      continue
    }

    if (inString) {
      if (char === '\n') {
        output += '\\n'
        continue
      }
      if (char === '\r') {
        output += '\\r'
        continue
      }
      if (char === '\t') {
        output += '\\t'
        continue
      }
      const code = char.charCodeAt(0)
      if (code >= 0 && code <= 0x1f) continue
    }

    output += char
  }

  return output
}

function extractLooseJsonFields(content: string): Record<string, unknown> {
  return {
    draft: extractLooseField(content, 'draft') || content,
    summary: extractLooseField(content, 'summary') || '',
    issues: extractLooseArray(content, 'issues'),
  }
}

function extractLooseField(content: string, field: string) {
  const pattern = new RegExp(`"${field}"\\s*:\\s*"([\\s\\S]*?)(?:"\\s*,\\s*"\\w+"\\s*:|"}\\s*$)`)
  const match = content.match(pattern)
  return match?.[1]?.replace(/\\"/g, '"').trim()
}

function extractLooseArray(content: string, field: string) {
  const match = content.match(new RegExp(`"${field}"\\s*:\\s*\\[([\\s\\S]*?)\\]`))
  if (!match) return []
  return Array.from(match[1].matchAll(/"([^"]+)"/g)).map((item) => item[1])
}

export function checkChapter(project: NovelProject, chapter: Chapter): string[] {
  const issues: string[] = []
  const cleanLength = chapter.draft.replace(/\s/g, '').length
  const ending = chapter.draft.trim().slice(-140)
  if (!chapter.draft.trim()) issues.push('等待生成正文。')
  if (cleanLength > 0 && cleanLength < 800) issues.push('草稿偏短，正式生成时建议扩展到 2500 字以上。')
  if (project.characters[0]?.name && chapter.draft && !chapter.draft.includes(project.characters[0].name)) {
    issues.push('主角没有出现在正文中。')
  }
  if (chapter.draft && !/[？?!！]|明天|下一次|忽然|发现|门|记录/.test(ending)) {
    issues.push('结尾钩子不够明确，建议补一个新问题、反转或行动压力。')
  }
  const overdue = project.foreshadowings.filter((item) => item.payoffBy < chapter.number && item.status !== '已回收')
  if (overdue.length) issues.push(`有 ${overdue.length} 个伏笔已经超过计划回收章节。`)
  return issues.length ? issues : ['未发现明显一致性问题，可进入人工润色。']
}

export function exportMarkdown(project: NovelProject) {
  return [
    `# ${project.title}`,
    '',
    `类型：${project.genre}`,
    `读者：${project.audience}`,
    '',
    '## 故事卖点',
    ...project.sellingPoints.map((item) => `- ${item}`),
    '',
    '## 正文',
    ...project.chapters.flatMap((chapter) => [
      '',
      `### ${chapter.title}`,
      '',
      chapter.draft || `> 未生成。目标：${chapter.goal}`,
    ]),
  ].join('\n')
}

function ensureApiKey(settings: AiSettings) {
  if (!settings.apiKey.trim()) {
    throw new Error('请先在“DeepSeek 接口”里填写 API Key。')
  }
}

function toArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

function text(value: unknown, fallback: string) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function numberValue(value: unknown, fallback: number) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function clampChapter(value: number, chapterCount: number) {
  return Math.min(Math.max(Math.round(value), 1), chapterCount)
}

function normalizeForeshadowStatus(value: unknown): Foreshadowing['status'] {
  return value === '已埋设' || value === '回收中' || value === '已回收' ? value : '未埋设'
}
