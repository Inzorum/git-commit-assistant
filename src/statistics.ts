import * as path from 'node:path';
import * as vscode from 'vscode';
import type { AppliedSuggestion, FileCategory, RepositorySnapshot } from './types';

const STORAGE_KEY = 'gitCommitAssistant.appliedSuggestions.v1';
const MAX_EVENTS = 500;

function escapeHtml(value: string): string {
  const entities: Record<string, string> = {
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  };
  return value.replace(/[&<>"']/g, character => entities[character]);
}

function bar(label: string, value: number, maximum: number, color: string): string {
  const width = maximum ? Math.max(2, Math.round(value / maximum * 100)) : 0;
  return `<div class="bar-row"><span>${escapeHtml(label)}</span><div class="track"><div class="fill ${color}" style="width:${width}%"></div></div><strong>${value}</strong></div>`;
}

export class StatisticsStore {
  constructor(private readonly context: vscode.ExtensionContext) {}

  private events(): AppliedSuggestion[] {
    return this.context.workspaceState.get<AppliedSuggestion[]>(STORAGE_KEY, []);
  }

  async record(event: AppliedSuggestion): Promise<void> {
    const events = [...this.events(), event].slice(-MAX_EVENTS);
    await this.context.workspaceState.update(STORAGE_KEY, events);
  }

  show(snapshot: RepositorySnapshot, days: number): void {
    const panel = vscode.window.createWebviewPanel(
      'gitCommitAssistantStatistics',
      'Git Commit Assistant: статистика',
      vscode.ViewColumn.Beside,
      { enableScripts: false }
    );
    panel.webview.html = this.html(snapshot, days);
  }

  private html(snapshot: RepositorySnapshot, days: number): string {
    const counts: Record<FileCategory, number> = {
      code: 0, docs: 0, tests: 0, config: 0, other: 0
    };
    for (const change of snapshot.changes) { counts[change.category]++; }
    const additions = snapshot.changes.reduce((sum, change) => sum + change.additions, 0);
    const deletions = snapshot.changes.reduce((sum, change) => sum + change.deletions, 0);
    const binaries = snapshot.changes.filter(change => change.binary).length;
    const repoEvents = this.events().filter(event => event.repository === snapshot.root);
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - days + 1);
    const recent = repoEvents.filter(event => new Date(event.timestamp) >= start);
    const byDay = Array.from({ length: days }, (_, index) => {
      const day = new Date(start);
      day.setDate(day.getDate() + index);
      const key = day.toLocaleDateString('sv-SE');
      return { label: day.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }),
        value: recent.filter(event => new Date(event.timestamp).toLocaleDateString('sv-SE') === key).length };
    });
    const categoryBars = (Object.entries(counts) as [FileCategory, number][])
      .map(([category, count]) => bar({ code: 'Код', docs: 'Документация', tests: 'Тесты',
        config: 'Настройки', other: 'Прочее' }[category], count, snapshot.changes.length, category))
      .join('');
    const activeDays = byDay.filter(day => day.value > 0);
    const dayBars = activeDays.length
      ? activeDays.map(day => bar(day.label, day.value, Math.max(...byDay.map(item => item.value)), 'activity')).join('')
      : '<p class="muted">За выбранный период предложений ещё не применяли.</p>';

    return `<!doctype html><html lang="ru"><head><meta charset="utf-8">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Статистика Git Commit Assistant</title>
      <style>
        body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);background:var(--vscode-editor-background);padding:24px;max-width:900px;margin:auto}
        h1{font-size:1.6rem}h2{font-size:1.1rem;margin-top:32px}.muted{color:var(--vscode-descriptionForeground)}
        .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px}.card{padding:16px;border:1px solid var(--vscode-panel-border);border-radius:6px}
        .card strong{display:block;font-size:1.5rem;margin-bottom:4px}.bar-row{display:grid;grid-template-columns:125px 1fr 35px;gap:12px;align-items:center;margin:10px 0}
        .track{height:12px;background:var(--vscode-editorWidget-background);border-radius:7px;overflow:hidden}.fill{height:100%;background:var(--vscode-charts-blue)}
        .docs{background:var(--vscode-charts-green)}.tests{background:var(--vscode-charts-orange)}.config{background:var(--vscode-charts-purple)}
        .other{background:var(--vscode-charts-yellow)}.activity{background:var(--vscode-charts-blue)}
      </style></head><body>
      <h1>Git Commit Assistant</h1><p class="muted">Репозиторий: ${escapeHtml(path.basename(snapshot.root))}</p>
      <h2>Сейчас подготовлено к коммиту</h2>
      <div class="cards"><div class="card"><strong>${snapshot.changes.length}</strong>файлов</div>
      <div class="card"><strong>+${additions}</strong>добавленных строк</div>
      <div class="card"><strong>−${deletions}</strong>удалённых строк</div>
      <div class="card"><strong>${binaries}</strong>бинарных файлов</div></div>
      <h2>Состав подготовленных файлов</h2>${categoryBars}
      <h2>Применённые предложения за ${days} дней</h2>
      <p class="muted">Учтена передача сообщения в терминал или поле Git. Это не число успешных коммитов.</p>
      <div class="cards"><div class="card"><strong>${recent.length}</strong>за период</div>
      <div class="card"><strong>${repoEvents.length}</strong>всего сохранено</div></div>${dayBars}
      </body></html>`;
  }
}
