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
