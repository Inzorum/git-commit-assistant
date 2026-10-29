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
