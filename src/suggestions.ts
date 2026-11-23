import * as path from 'node:path';
import type {
  AssistantSettings, CommitFormat, CommitType, DiffHints, FileCategory, MessageSuggestion, StagedChange
} from './types';

export function categorizePath(filePath: string): FileCategory {
  const name = filePath.toLowerCase().replaceAll('\\', '/');
  const base = path.posix.basename(name);
  if (/^(readme|changelog|contributing|license)(\.|$)/.test(base) ||
      /(^|\/)(docs?|documentation)\//.test(name) || /\.mdx?$/.test(name)) {
    return 'docs';
  }
  if (/(^|\/)(__tests__|tests?|specs?)\//.test(name) ||
      /\.(test|spec)\.[^.]+$/.test(name) || /^test_/.test(base)) {
    return 'tests';
  }
  if (/(^|\/)(\.github|\.vscode)\//.test(name) ||
      /^(package(-lock)?\.json|tsconfig.*\.json|\.gitignore|\.editorconfig|dockerfile|.*\.(ya?ml|toml))$/.test(base)) {
    return 'config';
  }
  if (/\.(tsx?|jsx?|py|c|cc|cpp|h|hpp|java|go|rs|cs|php|rb|swift|kt)$/.test(name)) {
    return 'code';
  }
  return 'other';
}

function inferScope(changes: StagedChange[]): string | undefined {
  const scopes = changes.map(change => {
    const segments = change.path.replaceAll('\\', '/').split('/');
    while (segments.length > 1 && /^(src|lib|app|test|tests|__tests__|packages)$/.test(segments[0])) {
      segments.shift();
    }
    return segments.length > 1 ? segments[0].toLowerCase().replace(/[^a-z0-9_-]/g, '') : undefined;
  });
  return scopes.length && scopes[0] && scopes.every(scope => scope === scopes[0])
    ? scopes[0] : undefined;
}

type ChangeAction = 'add' | 'remove' | 'rename' | 'update';
type ResolvedFormat = Exclude<CommitFormat, 'auto'>;

function action(change: StagedChange): ChangeAction {
  switch (change.status) {
    case 'added': return 'add';
    case 'deleted': return 'remove';
    case 'renamed': return 'rename';
    default: return 'update';
  }
}

function displayFile(filePath: string, category: FileCategory): string {
  const base = path.posix.basename(filePath.replaceAll('\\', '/'));
  if (category === 'config' || /^(main|index)\.[^.]+$/i.test(base)) { return base; }
  if (/^(readme|changelog|contributing|license)(\.|$)/i.test(base)) {
    return base.split('.')[0].toUpperCase();
  }
  return base.replace(/\.(test|spec)(?=\.[^.]+$)/, '').replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
}

function joinNames(names: string[], language: 'ru' | 'en'): string {
  return new Intl.ListFormat(language).format(names);
}

function functionList(names: string[], lang: 'en' | 'ru'): string {
  if (names.length <= 3) { return joinNames(names, lang); }
  if (lang === 'en') { return `${names.length} functions`; }
  const form = new Intl.PluralRules('ru').select(names.length);
  return `${names.length} ${form === 'one' ? 'функцию' : form === 'few' ? 'функции' : 'функций'}`;
}

function subject(change: StagedChange, type: CommitType, language: 'ru' | 'en', hints: DiffHints): string {
  const changeAction = action(change);
  const category = change.category;
  const file = displayFile(change.path, category);
  if (category === 'code' && type === 'feat' && hints.addedFunctions?.length) {
    const names = functionList(hints.addedFunctions, language);
    if (hints.addedFunctions.length > 3) {
      return language === 'ru' ? `добавить ${names} в ${file}` : `add ${names} to ${file}`;
    }
    return language === 'ru' ? `добавить ${hints.addedFunctions.length === 1 ? 'функцию' : 'функции'} ${names} в ${file}`
      : `add ${names} ${hints.addedFunctions.length === 1 ? 'function' : 'functions'} to ${file}`;
  }
  if (category === 'code' && changeAction === 'update') {
    const location = hints.functionName ? (language === 'ru' ? ` в ${hints.functionName}` : ` in ${hints.functionName}`) : '';
    if (type === 'refactor' && hints.intent === 'named-constant') {
      return language === 'ru' ? `заменить магическое число именованной константой${location}`
        : `replace magic number with named constant${location}`;
    }
    if (type === 'refactor' && hints.intent === 'rename-variables') {
      if (hints.parameter) { return language === 'ru' ? `переименовать параметр${location}` : `rename parameter${location}`; }
      return language === 'ru' ? `переименовать переменные${location}` : `rename variables${location}`;
    }
  }
  const topic = category === 'tests' ? (language === 'ru' ? `тесты ${file}` : `${file} tests`) : file;
  const name = category === 'code' && hints.functionName && changeAction === 'update'
    ? hints.functionName : topic;
  if (changeAction === 'rename' && change.previousPath) {
    const before = displayFile(change.previousPath, category);
    return language === 'ru' ? `переименовать ${before} в ${name}` : `rename ${before} to ${name}`;
  }
  if (changeAction === 'update' && category === 'code') {
    const verbs = language === 'ru'
      ? { feat: 'расширить', fix: 'исправить', refactor: 'переработать', chore: 'обновить' }
      : { feat: 'extend', fix: 'fix', refactor: 'refactor', chore: 'update' };
    if (type in verbs) { return `${verbs[type as keyof typeof verbs]} ${name}`; }
  }
  const verbs = language === 'ru'
    ? { add: 'добавить', remove: 'удалить', rename: 'переименовать', update: 'обновить' }
    : { add: 'add', remove: 'remove', rename: 'rename', update: 'update' };
  return `${verbs[changeAction]} ${name}`;
}

function shorten(value: string, limit: number): string {
  if (value.length <= limit) { return value; }
  const prefix = value.slice(0, limit);
  const wordBoundary = prefix.lastIndexOf(' ');
  return prefix.slice(0, wordBoundary > limit / 2 ? wordBoundary : limit).trimEnd();
}

function capitalize(value: string): string {
  return `${value[0].toUpperCase()}${value.slice(1)}`;
}

export function detectCommitFormat(subjects: string[]): ResolvedFormat {
  const counts: Record<ResolvedFormat, number> = { conventional: 0, scope: 0, bracket: 0, plain: 0 };
  for (const subject of subjects) {
    if (/^(Merge |Revert |release:|\d{4}-\d\d-\d\d, Version )/i.test(subject)) { continue; }
    if (/^(feat|fix|docs?|test|refactor|chore|build|ci|perf|style|release)(\([^)]+\))?:\s/i.test(subject)) {
      counts.conventional++;
    } else if (/^\[[^\]]+\]\s+\S/.test(subject)) {
      counts.bracket++;
    } else if (/^[\w][\w ./-]{0,30}:\s+\S/.test(subject)) {
      counts.scope++;
    } else if (subject.trim()) {
      counts.plain++;
    }
  }
  const ranked = (Object.keys(counts) as ResolvedFormat[]).sort((left, right) => counts[right] - counts[left]);
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  return total >= 3 && counts[ranked[0]] > counts[ranked[1]] && counts[ranked[0]] / total >= 0.4
    ? ranked[0] : 'conventional';
}

function makeMessage(type: CommitType, body: string, scope: string | undefined,
  category: FileCategory, settings: AssistantSettings, format: ResolvedFormat): string {
  const scoped = settings.scopeMode === 'auto' ? scope : undefined;
  const categoryPrefix: Record<FileCategory, string> = {
    code: 'src', docs: 'docs', tests: 'test', config: 'build', other: 'project'
  };
  let value: string;
  if (format === 'conventional') {
    value = `${type}${scoped ? `(${scoped})` : ''}: ${body}`;
  } else if (format === 'scope' && settings.scopeMode === 'auto') {
    value = `${scoped || categoryPrefix[category]}: ${body}`;
  } else if (format === 'bracket' && settings.scopeMode === 'auto') {
    value = `[${scoped || categoryPrefix[category]}] ${capitalize(body)}`;
  } else {
    value = capitalize(body);
  }
  return shorten(value, settings.maxSubjectLength);
}

function fileSuggestions(change: StagedChange, settings: AssistantSettings,
  format: ResolvedFormat, hints: DiffHints): MessageSuggestion[] {
  const category = change.category;
  const scope = inferScope([change]);

  const primary: CommitType = category === 'docs' ? 'docs'
    : category === 'tests' ? 'test'
      : category === 'code' && action(change) === 'add' ? 'feat'
      : category === 'code' && hints.addedFunctions?.length ? 'feat'
        : category === 'code' && hints.intent ? 'refactor'
          : category === 'code' ? settings.defaultCodeType : 'chore';
  const types: CommitType[] = category === 'code' && action(change) === 'update'
    ? [...new Set<CommitType>([primary, 'feat', 'fix', 'refactor', 'chore'])]
    : [primary];

  const suggestions = types.map(type => {
    let body = subject(change, type, settings.language, hints);
    if (type === 'feat' && hints.addedFunctions?.length) {
      const fullMessage = makeMessage(type, body, scope, category,
        { ...settings, maxSubjectLength: Number.MAX_SAFE_INTEGER }, format);
      if (fullMessage.length > settings.maxSubjectLength) {
        const names = functionList(hints.addedFunctions, settings.language);
        const plural = hints.addedFunctions.length > 1;
        const compact = hints.addedFunctions.length > 3 ? (settings.language === 'ru' ? 'добавить ' : 'add ') + names
          : settings.language === 'ru' ? `добавить ${plural ? 'функции' : 'функцию'} ${names}`
          : `add ${names} ${plural ? 'functions' : 'function'}`;
        const compactMessage = makeMessage(type, compact, scope, category,
          { ...settings, maxSubjectLength: Number.MAX_SAFE_INTEGER }, format);
        body = compactMessage.length <= settings.maxSubjectLength ? compact
          : subject(change, type, settings.language,
            { ...hints, addedFunctions: undefined });
      }
    }
    const message = makeMessage(type, body, scope, category, settings, format);
    const description = type === 'refactor' && hints.intent === 'named-constant'
      ? (settings.language === 'ru' ? 'Найдена именованная константа в staged diff' : 'Named constant detected in staged diff')
      : type === 'refactor' && hints.intent === 'rename-variables'
        ? (settings.language === 'ru' ? 'Найдено переименование переменной в staged diff' : 'Variable rename detected in staged diff')
        : ({
          ru: { feat: 'Если добавлено поведение', fix: 'Если исправлена ошибка',
            refactor: 'Если поведение не изменилось', chore: 'Нейтральный вариант',
            docs: 'Документация', test: 'Тесты' },
          en: { feat: 'If behavior was added', fix: 'If a bug was fixed',
            refactor: 'If behavior is unchanged', chore: 'Neutral option',
            docs: 'Documentation', test: 'Tests' }
        })[settings.language][type];
    return {
      label: message,
      description,
      message,
      type
    };
  });
  return suggestions.filter((suggestion, index) =>
    suggestions.findIndex(candidate => candidate.message === suggestion.message) === index);
}

interface ChangePart {
  change: StagedChange;
  body: string;
  choices: MessageSuggestion[];
}

export function buildSuggestions(changes: StagedChange[], settings: AssistantSettings,
  recentSubjects: string[] = [], byFile: ReadonlyMap<string, DiffHints[]> = new Map()): MessageSuggestion[] {
  if (!changes.length) { return []; }
  const format = settings.format === 'auto' ? detectCommitFormat(recentSubjects) : settings.format;
  const lang = settings.language;
  const parts: ChangePart[] = [];
  for (const change of changes) {
    const facts = byFile.get(change.path);
    for (const hint of facts?.length ? facts : [{}]) {
      const choices = fileSuggestions(change, settings, format, hint);
      const body = hint.addedFunctions?.length
        ? (lang === 'ru' ? 'добавить ' : 'add ') + functionList(hint.addedFunctions, lang)
        : subject(change, choices[0].type, lang, hint);
      parts.push({ change, body, choices });
    }
  }
  if (parts.length === 1) { return parts[0].choices; }

  const categories: FileCategory[] = ['code', 'tests', 'docs', 'config', 'other'];
  parts.sort((a, b) => categories.indexOf(a.change.category) - categories.indexOf(b.change.category));
  const category = parts[0].change.category;
  const type = parts.some(part => part.choices[0].type === 'feat') ? 'feat' : parts[0].choices[0].type;
  const scope = inferScope(changes);
  const unbounded = { ...settings, maxSubjectLength: Infinity };
  const title = (body: string) => makeMessage(type, body, scope, category, unbounded, format);
  const frequency = new Map<string, number>();
  for (const { body } of parts) { frequency.set(body, (frequency.get(body) ?? 0) + 1); }
  const clauses = parts.map(({ body, change }) =>
    frequency.get(body) === 1 ? body : `${body} (${change.path})`);
  const categoryLabels = lang === 'ru'
    ? { code: 'код', tests: 'тесты', docs: 'документацию', config: 'настройки', other: 'файлы проекта' }
    : { code: 'code', tests: 'tests', docs: 'docs', config: 'configuration', other: 'project files' };
  const update = lang === 'ru' ? 'обновить ' : 'update ';
  const labels = [...new Set(parts.map(part => categoryLabels[part.change.category]))];
  const summaries = [joinNames(clauses, lang), clauses.join(', '), update + joinNames(labels, lang)];
  const fallback = lang === 'ru' ? 'обновить проект' : 'update project';
  const message = summaries.map(title).find(value => value.length <= settings.maxSubjectLength)
    ?? makeMessage(type, fallback, undefined, category, settings, format);
  const overview = { type, message, label: message,
    description: lang === 'ru' ? 'Все подготовленные изменения' : 'All staged changes' };
  const focused = parts.map(part => ({
    ...part.choices[0], description: part.change.path
  }));
  return [overview, ...focused];
}
