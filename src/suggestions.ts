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

function mainCategory(changes: StagedChange[]): FileCategory {
  for (const category of ['code', 'tests', 'docs', 'config', 'other'] as const) {
    if (changes.some(change => change.category === category)) { return category; }
  }
  return 'other';
}

type ChangeAction = 'add' | 'remove' | 'rename' | 'update';
type ResolvedFormat = Exclude<CommitFormat, 'auto'>;

function action(changes: StagedChange[]): ChangeAction {
  if (changes.every(change => change.status === 'added')) { return 'add'; }
  if (changes.every(change => change.status === 'deleted')) { return 'remove'; }
  if (changes.every(change => change.status === 'renamed')) { return 'rename'; }
  return 'update';
}

function displayFile(filePath: string, category: FileCategory): string {
  const base = path.posix.basename(filePath.replaceAll('\\', '/'));
  if (category === 'config' || /^(main|index)\.[^.]+$/i.test(base)) { return base; }
  if (/^(readme|changelog|contributing|license)(\.|$)/i.test(base)) {
    return base.split('.')[0].toUpperCase();
  }
  return base.replace(/\.(test|spec)(?=\.[^.]+$)/, '').replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
}

function topic(changes: StagedChange[], category: FileCategory, scope: string | undefined, language: 'ru' | 'en'): string {
  const relevant = changes.filter(change => change.category === category);
  if (relevant.length === 1) {
    const name = displayFile(relevant[0].path, category);
    if (category === 'tests') { return language === 'ru' ? `тесты ${name}` : `${name} tests`; }
    return name;
  }
  if (category === 'code' && scope) { return language === 'ru' ? `модуль ${scope}` : `${scope} module`; }
  if (category === 'code' && relevant.length === 2) {
    const names = relevant.map(change => displayFile(change.path, category));
    return names[0] === names[1] ? names[0]
      : `${names[0]}${language === 'ru' ? ' и ' : ' and '}${names[1]}`;
  }
  if (category === 'code' && relevant.length > 2) {
    return language === 'ru' ? `${relevant.length} исходных файла` : `${relevant.length} source files`;
  }
  const fallback = {
    ru: { code: 'исходный код', docs: 'документацию', tests: 'тесты', config: 'конфигурацию', other: 'файлы проекта' },
    en: { code: 'source code', docs: 'documentation', tests: 'tests', config: 'configuration', other: 'project files' }
  };
  return fallback[language][category];
}

function joinNames(names: string[], language: 'ru' | 'en'): string {
  if (names.length === 1) { return names[0]; }
  const conjunction = language === 'ru' ? ' и ' : ' and ';
  return `${names.slice(0, -1).join(', ')}${names.length > 2 ? ',' : ''}${conjunction}${names.at(-1)}`;
}

function subject(changes: StagedChange[], category: FileCategory, scope: string | undefined,
  type: CommitType, language: 'ru' | 'en', hints: DiffHints): string {
  const changeAction = action(changes);
  const codeFiles = changes.filter(change => change.category === 'code');
  if (category === 'code' && type === 'feat' && hints.addedFunctions?.length && codeFiles.length === 1) {
    const file = displayFile(codeFiles[0].path, category);
    const names = joinNames(hints.addedFunctions, language);
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
      return language === 'ru' ? `переименовать переменные${location}` : `rename variables${location}`;
    }
  }
  const name = category === 'code' && hints.functionName && changeAction === 'update'
    ? hints.functionName : topic(changes, category, scope, language);
  if (changeAction === 'rename' && changes.length === 1 && changes[0].previousPath) {
    const before = displayFile(changes[0].previousPath, category);
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

export function buildSuggestions(changes: StagedChange[], settings: AssistantSettings,
  recentSubjects: string[] = [], hints: DiffHints = {}): MessageSuggestion[] {
  if (!changes.length) { return []; }
  const category = mainCategory(changes);
  const scope = inferScope(changes);
  const format = settings.format === 'auto' ? detectCommitFormat(recentSubjects) : settings.format;

  const primary: CommitType = category === 'docs' ? 'docs'
    : category === 'tests' ? 'test'
      : category === 'code' && action(changes) === 'add' ? 'feat'
      : category === 'code' && hints.addedFunctions?.length && changes.filter(change => change.category === 'code').length === 1 ? 'feat'
        : category === 'code' && hints.intent ? 'refactor'
          : category === 'code' ? settings.defaultCodeType : 'chore';
  const types: CommitType[] = category === 'code' && action(changes) === 'update'
    ? [...new Set<CommitType>([primary, 'feat', 'fix', 'refactor', 'chore'])]
    : [primary];

  const suggestions = types.map(type => {
    let body = subject(changes, category, scope, type, settings.language, hints);
    if (type === 'feat' && hints.addedFunctions?.length) {
      const fullMessage = makeMessage(type, body, scope, category,
        { ...settings, maxSubjectLength: Number.MAX_SAFE_INTEGER }, format);
      if (fullMessage.length > settings.maxSubjectLength) {
        const names = joinNames(hints.addedFunctions, settings.language);
        const compact = settings.language === 'ru'
          ? `добавить функции ${names}` : `add ${names} functions`;
        const compactMessage = makeMessage(type, compact, scope, category,
          { ...settings, maxSubjectLength: Number.MAX_SAFE_INTEGER }, format);
        body = compactMessage.length <= settings.maxSubjectLength ? compact
          : subject(changes, category, scope, type, settings.language,
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
