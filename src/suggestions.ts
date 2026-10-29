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
