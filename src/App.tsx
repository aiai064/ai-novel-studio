import {
  BookOpen,
  BrainCircuit,
  CalendarDays,
  CheckCircle2,
  Clipboard,
  Clock3,
  Copy,
  Database,
  Download,
  Eye,
  FileText,
  KeyRound,
  Library,
  ListChecks,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  SearchCheck,
  Settings,
  Sparkles,
  Upload,
  Users,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import {
  buildChapterContextPreview,
  auditChapterConsistencyWithDeepSeek,
  compactMemoryWithDeepSeek,
  createBlankProject,
  createProjectWithDeepSeek,
  exportMarkdown,
  generateChapterWithDeepSeek,
  refreshChapterPlanWithDeepSeek,
} from './engine'
import { loadProject, loadSettings, saveProject, saveSettings } from './storage'
import { migrateProject } from './storage'
import type { AiSettings, Chapter, NovelProject, TimelineEvent, Tone } from './types'

const tones: Tone[] = ['热血爽文', '悬疑克制', '轻喜群像', '史诗厚重']
type InspectorTab = 'quality' | 'bible' | 'memory' | 'timeline'

const initialForm = {
  title: '',
  genre: '',
  audience: '',
  targetWords: 120000,
  chapterCount: 30,
  tone: '悬疑克制' as Tone,
  premise: '',
}

function downloadText(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export function App() {
  const [project, setProject] = useState<NovelProject>(() => loadProject() ?? createBlankProject(initialForm))
  const [settings, setSettings] = useState<AiSettings>(() => loadSettings())
  const [selectedId, setSelectedId] = useState(project.chapters[0]?.id ?? '')
  const [form, setForm] = useState(initialForm)
  const [isGenerating, setIsGenerating] = useState(false)
  const [isPlanning, setIsPlanning] = useState(false)
  const [isCompacting, setIsCompacting] = useState(false)
  const [isAuditing, setIsAuditing] = useState(false)
  const [error, setError] = useState('')
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('quality')
  const [inspectorEditing, setInspectorEditing] = useState(false)
  const [toast, setToast] = useState('')
  const [contextOpen, setContextOpen] = useState(false)

  useEffect(() => saveProject(project), [project])
  useEffect(() => saveSettings(settings), [settings])

  const selectedChapter = useMemo(
    () => project.chapters.find((chapter) => chapter.id === selectedId) ?? project.chapters[0],
    [project.chapters, selectedId],
  )

  const generatedCount = project.chapters.filter((chapter) => chapter.draft).length
  const progress = Math.round((generatedCount / project.chapters.length) * 100)
  const selectedDraftLength = selectedChapter?.draft.replace(/\s/g, '').length ?? 0
  const chapterTargetLength = Math.min(Math.max(Math.round(project.targetWords / Math.max(project.chapterCount, 1)), 3000), 6000)
  const selectedUpdatedAt = selectedChapter?.updatedAt
    ? new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(
        new Date(selectedChapter.updatedAt),
      )
    : '未保存'

  function updateProject(next: NovelProject) {
    setProject(next)
    if (!next.chapters.some((chapter) => chapter.id === selectedId)) {
      setSelectedId(next.chapters[0]?.id ?? '')
    }
  }

  function switchInspectorTab(tab: InspectorTab) {
    setInspectorTab(tab)
    setInspectorEditing(false)
  }

  function saveInspectorEdits() {
    setInspectorEditing(false)
    setToast('设定已保存')
    window.setTimeout(() => setToast(''), 1600)
  }

  async function createFreshProject() {
    setIsPlanning(true)
    setError('')
    try {
      const next = await createProjectWithDeepSeek(form, settings)
      updateProject(next)
      setToast('AI 项目圣经已生成')
      window.setTimeout(() => setToast(''), 1600)
    } catch (err) {
      setError(err instanceof Error ? err.message : '项目生成失败，请稍后重试。')
    } finally {
      setIsPlanning(false)
    }
  }

  async function optimizeOutline() {
    setIsPlanning(true)
    setError('')
    try {
      const next = await refreshChapterPlanWithDeepSeek(project, settings)
      updateProject(next)
      setToast('AI 章节流水线已生成')
      window.setTimeout(() => setToast(''), 1600)
    } catch (err) {
      setError(err instanceof Error ? err.message : '大纲优化失败，请稍后重试。')
    } finally {
      setIsPlanning(false)
    }
  }

  async function runChapter() {
    if (!selectedChapter) return
    setIsGenerating(true)
    setError('')
    try {
      const next = await generateChapterWithDeepSeek(project, selectedChapter.id, settings)
      updateProject(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : '生成失败，请稍后重试。')
    } finally {
      setIsGenerating(false)
    }
  }

  async function compactMemory() {
    setIsCompacting(true)
    setError('')
    try {
      updateProject(await compactMemoryWithDeepSeek(project, settings))
      setToast('长期记忆已整理')
      window.setTimeout(() => setToast(''), 1600)
    } catch (err) {
      setError(err instanceof Error ? err.message : '记忆整理失败，请稍后重试。')
    } finally {
      setIsCompacting(false)
    }
  }

  async function auditChapter() {
    if (!selectedChapter) return
    setIsAuditing(true)
    setError('')
    try {
      updateProject(await auditChapterConsistencyWithDeepSeek(project, selectedChapter.id, settings))
      setToast('冲突审校已完成')
      window.setTimeout(() => setToast(''), 1600)
      setInspectorTab('quality')
    } catch (err) {
      setError(err instanceof Error ? err.message : '冲突审校失败，请稍后重试。')
    } finally {
      setIsAuditing(false)
    }
  }

  async function copyDraft() {
    if (!selectedChapter?.draft) return
    await navigator.clipboard.writeText(selectedChapter.draft)
    setToast('正文已复制')
    window.setTimeout(() => setToast(''), 1600)
  }

  function selectNextChapter() {
    if (!selectedChapter) return
    const next = project.chapters.find((chapter) => chapter.number === selectedChapter.number + 1)
    if (next) setSelectedId(next.id)
  }

  function updateChapter(patch: Partial<Chapter>) {
    if (!selectedChapter) return
    updateProject({
      ...project,
      chapters: project.chapters.map((chapter) =>
        chapter.id === selectedChapter.id ? { ...chapter, ...patch, updatedAt: new Date().toISOString() } : chapter,
      ),
    })
  }

  function updateCharacter(id: string, field: 'name' | 'role' | 'desire' | 'secret' | 'status', value: string) {
    updateProject({
      ...project,
      characters: project.characters.map((item) => (item.id === id ? { ...item, [field]: value } : item)),
    })
  }

  function updateWorldItem(id: string, field: 'name' | 'category' | 'rule', value: string) {
    updateProject({
      ...project,
      worldItems: project.worldItems.map((item) => (item.id === id ? { ...item, [field]: value } : item)),
    })
  }

  function updateForeshadowing(id: string, field: 'title' | 'status' | 'plantedIn' | 'payoffBy', value: string) {
    updateProject({
      ...project,
      foreshadowings: project.foreshadowings.map((item) =>
        item.id === id
          ? {
              ...item,
              [field]: field === 'plantedIn' || field === 'payoffBy' ? Number(value) : value,
            }
          : item,
      ),
    })
  }

  function updateTimelineEvent(id: string, field: keyof Omit<TimelineEvent, 'id'>, value: string) {
    updateProject({
      ...project,
      timelineEvents: project.timelineEvents.map((item) =>
        item.id === id ? { ...item, [field]: field === 'chapterNumber' ? Number(value) : value } : item,
      ),
    })
  }

  function exportProjectJson() {
    downloadText(`${project.title || 'novel-project'}.json`, JSON.stringify(project, null, 2))
  }

  function importProjectJson(file: File | undefined) {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const next = migrateProject(JSON.parse(String(reader.result)) as NovelProject)
        if (!Array.isArray(next.chapters)) throw new Error('项目文件缺少 chapters。')
        updateProject(next)
        setToast('项目已导入')
        window.setTimeout(() => setToast(''), 1600)
      } catch (err) {
        setError(err instanceof Error ? err.message : '项目导入失败。')
      }
    }
    reader.readAsText(file)
  }

  const contextPreview = buildChapterContextPreview(project, selectedChapter, settings.contextMode)

  return (
    <main className="shell">
      <aside className="rail">
        <div className="brand">
          <div className="mark">
            <BookOpen size={22} />
          </div>
          <div>
            <p className="eyebrow">AI Novel Studio</p>
            <h1>长篇小说工作台</h1>
          </div>
        </div>

        <section className="panel project-panel">
          <div className="panel-title">
            <Sparkles size={18} />
            <h2>项目种子</h2>
          </div>
          <label>
            书名
            <input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
          </label>
          <label>
            类型
            <input value={form.genre} onChange={(event) => setForm({ ...form, genre: event.target.value })} />
          </label>
          <label>
            核心创意
            <textarea value={form.premise} onChange={(event) => setForm({ ...form, premise: event.target.value })} />
          </label>
          <div className="field-grid">
            <label>
              章节
              <input
                type="number"
                min={5}
                max={200}
                value={form.chapterCount}
                onChange={(event) => setForm({ ...form, chapterCount: Number(event.target.value) })}
              />
            </label>
            <label>
              字数
              <input
                type="number"
                min={10000}
                step={10000}
                value={form.targetWords}
                onChange={(event) => setForm({ ...form, targetWords: Number(event.target.value) })}
              />
            </label>
          </div>
          <label>
            文风
            <select value={form.tone} onChange={(event) => setForm({ ...form, tone: event.target.value as Tone })}>
              {tones.map((tone) => (
                <option key={tone}>{tone}</option>
              ))}
            </select>
          </label>
          <button className="primary" onClick={createFreshProject} disabled={isPlanning}>
            <Plus size={17} />
            {isPlanning ? '生成中' : 'AI 生成新项目'}
          </button>
        </section>

        <section className="panel compact">
          <div className="panel-title">
            <Settings size={18} />
            <h2>DeepSeek 接口</h2>
          </div>
          <input
            placeholder="Base URL"
            value={settings.endpoint}
            onChange={(event) => setSettings({ ...settings, endpoint: event.target.value })}
          />
          <input
            placeholder="模型名"
            value={settings.model}
            onChange={(event) => setSettings({ ...settings, model: event.target.value })}
          />
          <div className="segmented">
            <button
              className={settings.contextMode === 'full' ? 'active' : ''}
              onClick={() => setSettings({ ...settings, contextMode: 'full' })}
            >
              全文上下文
            </button>
            <button
              className={settings.contextMode === 'smart' ? 'active' : ''}
              onClick={() => setSettings({ ...settings, contextMode: 'smart' })}
            >
              智能摘要
            </button>
          </div>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={settings.cacheEnabled}
              onChange={(event) => setSettings({ ...settings, cacheEnabled: event.target.checked })}
            />
            请求缓存
          </label>
          <input
            placeholder="DeepSeek API Key"
            type="password"
            value={settings.apiKey}
            onChange={(event) => setSettings({ ...settings, apiKey: event.target.value })}
          />
          <div className="hint">
            <KeyRound size={14} />
            Key 仅保存在当前浏览器，本地代理负责转发请求。
          </div>
        </section>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">{project.genre}</p>
            <h2>{project.title}</h2>
            <p>{project.logline}</p>
          </div>
          <div className="actions">
            <button onClick={() => updateProject(createBlankProject(form))}>
              <RotateCcw size={17} />
              重置
            </button>
            <button onClick={() => downloadText(`${project.title}.md`, exportMarkdown(project))}>
              <Download size={17} />
              导出 MD
            </button>
            <button onClick={exportProjectJson}>
              <Database size={17} />
              备份 JSON
            </button>
            <label className="file-button">
              <Upload size={17} />
              导入 JSON
              <input type="file" accept="application/json,.json" onChange={(event) => importProjectJson(event.target.files?.[0])} />
            </label>
          </div>
        </header>

        <section className="metrics">
          <Metric icon={<Library size={18} />} label="目标字数" value={project.targetWords.toLocaleString()} />
          <Metric icon={<FileText size={18} />} label="章节进度" value={`${generatedCount}/${project.chapterCount}`} />
          <Metric icon={<CheckCircle2 size={18} />} label="完成度" value={`${progress}%`} />
          <Metric
            icon={<CalendarDays size={18} />}
            label="时间线"
            value={String(project.timelineEvents.length)}
          />
        </section>

        <section className="story-strip">
          {project.sellingPoints.map((point) => (
            <span key={point}>{point}</span>
          ))}
        </section>

        <section className="main-grid">
          <nav className="chapter-list">
            <div className="sticky-title">
              <div className="panel-title">
                <FileText size={18} />
                <h2>章节流水线</h2>
              </div>
              <button onClick={optimizeOutline} disabled={isPlanning}>
                <RefreshCw size={15} />
                AI 优化大纲
              </button>
            </div>
            {project.chapters.map((chapter) => (
              <button
                key={chapter.id}
                className={chapter.id === selectedChapter?.id ? 'chapter active' : 'chapter'}
                onClick={() => setSelectedId(chapter.id)}
              >
                <span>{chapter.number.toString().padStart(2, '0')}</span>
                <strong>{chapter.title.replace(/^第 \d+ 章 /, '')}</strong>
                <small>{chapter.draft ? '已生成' : '待生成'}</small>
              </button>
            ))}
          </nav>

          <article className="writer">
            {selectedChapter && (
              <>
                <div className="writer-head">
                  <div>
                    <p className="eyebrow">Chapter {selectedChapter.number}</p>
                    <input
                      className="title-input"
                      value={selectedChapter.title}
                      onChange={(event) => updateChapter({ title: event.target.value })}
                    />
                  </div>
                  <button className="primary" onClick={runChapter} disabled={isGenerating}>
                    <Play size={17} />
                    {isGenerating ? '生成中' : '生成本章'}
                  </button>
                </div>
                <div className="chapter-tools">
                  <span>
                    <Clipboard size={15} />
                    正文 {selectedDraftLength.toLocaleString()} / {chapterTargetLength.toLocaleString()} 字
                  </span>
                  <span>
                    <Clock3 size={15} />
                    更新 {selectedUpdatedAt}
                  </span>
                  <span>
                    <BrainCircuit size={15} />
                    {settings.model}
                  </span>
                  <button onClick={copyDraft} disabled={!selectedChapter.draft}>
                    <Copy size={15} />
                    复制正文
                  </button>
                  <button onClick={() => setContextOpen((value) => !value)}>
                    <Eye size={15} />
                    上下文
                  </button>
                  <button onClick={auditChapter} disabled={!selectedChapter.draft || isAuditing}>
                    <SearchCheck size={15} />
                    {isAuditing ? '审校中' : '审校冲突'}
                  </button>
                  <button onClick={selectNextChapter} disabled={selectedChapter.number >= project.chapterCount}>
                    下一章
                  </button>
                </div>
                {contextOpen && (
                  <section className="context-preview">
                    <div className="panel-title">
                      <Eye size={17} />
                      <h2>发送给 DeepSeek 的上下文预览</h2>
                    </div>
                    <pre>{contextPreview}</pre>
                  </section>
                )}
                {toast && <div className="toast">{toast}</div>}
                {error && <div className="error-box">{error}</div>}
                <label>
                  章节目标
                  <textarea
                    className="goal"
                    value={selectedChapter.goal}
                    onChange={(event) => updateChapter({ goal: event.target.value })}
                  />
                </label>
                <label>
                  场景纲
                  <textarea
                    className="outline"
                    value={selectedChapter.outline}
                    onChange={(event) => updateChapter({ outline: event.target.value })}
                  />
                </label>
                <label className="draft-block">
                  正文草稿
                  <textarea
                    value={selectedChapter.draft}
                    placeholder="点击“生成本章”后，这里会产出章节草稿。你也可以直接人工编辑。"
                    onChange={(event) => updateChapter({ draft: event.target.value })}
                  />
                </label>
                <div className="summary-box">
                  <Save size={17} />
                  <span>{selectedChapter.summary || '章节完成后会自动生成摘要，并写入长期记忆。'}</span>
                </div>
              </>
            )}
          </article>

          <aside className="inspector">
            <div className="tabs">
              <button className={inspectorTab === 'quality' ? 'active' : ''} onClick={() => switchInspectorTab('quality')}>
                检查
              </button>
              <button className={inspectorTab === 'bible' ? 'active' : ''} onClick={() => switchInspectorTab('bible')}>
                设定
              </button>
              <button className={inspectorTab === 'memory' ? 'active' : ''} onClick={() => switchInspectorTab('memory')}>
                记忆
              </button>
              <button className={inspectorTab === 'timeline' ? 'active' : ''} onClick={() => switchInspectorTab('timeline')}>
                时间线
              </button>
            </div>
            {inspectorTab !== 'quality' && (
              <div className="edit-bar">
                {inspectorEditing ? (
                  <button className="primary" onClick={saveInspectorEdits}>
                    <Save size={16} />
                    保存
                  </button>
                ) : (
                  <button onClick={() => setInspectorEditing(true)}>编辑</button>
                )}
              </div>
            )}

            {inspectorTab === 'quality' && (
              <>
                <section className="panel">
                  <div className="panel-title">
                    <SearchCheck size={18} />
                    <h2>一致性检查</h2>
                  </div>
                  <button className="full-button" onClick={auditChapter} disabled={!selectedChapter?.draft || isAuditing}>
                    <SearchCheck size={16} />
                    {isAuditing ? '审校中' : 'AI 审校章节冲突'}
                  </button>
                  <ul className="issue-list">
                    {(selectedChapter?.issues.length ? selectedChapter.issues : ['等待章节生成。']).map((issue) => (
                      <li key={issue}>{issue}</li>
                    ))}
                  </ul>
                </section>
                <section className="panel">
                  <div className="panel-title">
                    <ListChecks size={18} />
                    <h2>本章摘要</h2>
                  </div>
                  <p className="memory-text">{selectedChapter?.summary || '生成章节后会自动沉淀摘要。'}</p>
                </section>
              </>
            )}

            {inspectorTab === 'bible' && (
              <>
                <section className="panel">
                  <div className="panel-title">
                    <Users size={18} />
                    <h2>人物状态</h2>
                  </div>
                  {project.characters.map((character) => (
                    <div className="mini-card" key={character.id}>
                      {inspectorEditing ? (
                        <>
                          <input value={character.name} onChange={(event) => updateCharacter(character.id, 'name', event.target.value)} />
                          <input value={character.role} onChange={(event) => updateCharacter(character.id, 'role', event.target.value)} />
                          <textarea value={character.status} onChange={(event) => updateCharacter(character.id, 'status', event.target.value)} />
                        </>
                      ) : (
                        <>
                          <strong>{character.name}</strong>
                          <span>{character.role}</span>
                          <p>{character.status}</p>
                        </>
                      )}
                    </div>
                  ))}
                </section>
                <section className="panel">
                  <div className="panel-title">
                    <Library size={18} />
                    <h2>世界规则</h2>
                  </div>
                  {project.worldItems.map((item) => (
                    <div className="mini-card" key={item.id}>
                      {inspectorEditing ? (
                        <>
                          <input value={item.name} onChange={(event) => updateWorldItem(item.id, 'name', event.target.value)} />
                          <input value={item.category} onChange={(event) => updateWorldItem(item.id, 'category', event.target.value)} />
                          <textarea value={item.rule} onChange={(event) => updateWorldItem(item.id, 'rule', event.target.value)} />
                        </>
                      ) : (
                        <>
                          <strong>{item.name}</strong>
                          <span>{item.category}</span>
                          <p>{item.rule}</p>
                        </>
                      )}
                    </div>
                  ))}
                </section>
              </>
            )}

            {inspectorTab === 'memory' && (
              <>
                <section className="panel">
                  <div className="panel-title">
                    <BrainCircuit size={18} />
                    <h2>伏笔表</h2>
                  </div>
                  {project.foreshadowings.map((item) => (
                    <div className="foreshadow" key={item.id}>
                      {inspectorEditing ? (
                        <>
                          <select value={item.status} onChange={(event) => updateForeshadowing(item.id, 'status', event.target.value)}>
                            <option>未埋设</option>
                            <option>已埋设</option>
                            <option>回收中</option>
                            <option>已回收</option>
                          </select>
                          <input value={item.title} onChange={(event) => updateForeshadowing(item.id, 'title', event.target.value)} />
                          <div className="field-grid">
                            <input
                              type="number"
                              value={item.plantedIn}
                              onChange={(event) => updateForeshadowing(item.id, 'plantedIn', event.target.value)}
                            />
                            <input
                              type="number"
                              value={item.payoffBy}
                              onChange={(event) => updateForeshadowing(item.id, 'payoffBy', event.target.value)}
                            />
                          </div>
                        </>
                      ) : (
                        <>
                          <span>{item.status}</span>
                          <p>{item.title}</p>
                          <small>
                            埋设 {item.plantedIn} / 回收 {item.payoffBy}
                          </small>
                        </>
                      )}
                    </div>
                  ))}
                </section>
                <section className="panel">
                  <div className="panel-title">
                    <BrainCircuit size={18} />
                    <h2>长期记忆</h2>
                  </div>
                  <button className="full-button" onClick={compactMemory} disabled={isCompacting}>
                    <BrainCircuit size={16} />
                    {isCompacting ? '整理中' : 'AI 整理记忆'}
                  </button>
                  <p className="memory-text">{project.globalMemory}</p>
                </section>
              </>
            )}

            {inspectorTab === 'timeline' && (
              <section className="panel">
                <div className="panel-title">
                  <CalendarDays size={18} />
                  <h2>事件时间线</h2>
                </div>
                {project.timelineEvents.length ? (
                  project.timelineEvents.map((item) => (
                    <div className="mini-card" key={item.id}>
                      {inspectorEditing ? (
                        <>
                          <input
                            type="number"
                            value={item.chapterNumber}
                            onChange={(event) => updateTimelineEvent(item.id, 'chapterNumber', event.target.value)}
                          />
                          <input value={item.title} onChange={(event) => updateTimelineEvent(item.id, 'title', event.target.value)} />
                          <textarea value={item.detail} onChange={(event) => updateTimelineEvent(item.id, 'detail', event.target.value)} />
                        </>
                      ) : (
                        <>
                          <strong>第 {item.chapterNumber} 章｜{item.title}</strong>
                          <p>{item.detail}</p>
                        </>
                      )}
                    </div>
                  ))
                ) : (
                  <p className="memory-text">生成章节或整理记忆后会沉淀事件时间线。</p>
                )}
              </section>
            )}
          </aside>
        </section>
      </section>
    </main>
  )
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="metric">
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}
