import type { DiffHints } from './types';

const IDENTIFIER = /^[A-Za-z_][A-Za-z_0-9]*$/;
const KEYWORDS = new Set(['const', 'let', 'var', 'int', 'long', 'short', 'char', 'float', 'double',
  'bool', 'boolean', 'string', 'auto', 'return', 'if', 'else', 'for', 'while', 'function',
  'public', 'private', 'static', 'void', 'true', 'false', 'null', 'undefined']);

function declaredFunction(line: string): string | undefined {
  const text = line.trim();
  if (/^(?:return|throw|new|await|if|for|while|switch|catch|else)\b/.test(text) ||
      text.startsWith('//') || text.startsWith('*')) { return undefined; }
  const patterns = [
    /^(?:(?:export|default|async|static|inline)\s+)*function\s*\*?\s*([A-Za-z_][A-Za-z_0-9]*)\s*\(/,
    /^(?:async\s+)?def\s+([A-Za-z_][A-Za-z_0-9]*)\s*\(/,
    /^func\s+(?:\([^)]*\)\s*)?([A-Za-z_][A-Za-z_0-9]*)\s*\(/,
    /^(?:(?:export|declare|default)\s+)*(?:const|let|var)\s+([A-Za-z_][A-Za-z_0-9]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_][A-Za-z_0-9]*)\s*(?::\s*[^=]+)?=>/,
    /^(?:(?:public|private|protected|static|virtual|inline|constexpr|async|final|override|export|default)\s+)*(?:[\w:<>,*&\[\]?]+\s+)+([A-Za-z_][A-Za-z_0-9]*)\s*\([^;]*\)\s*(?:const\s*)?(?:\{|:|=>|$)/
  ];
  for (const pattern of patterns) {
    const name = pattern.exec(text)?.[1];
    if (name && !KEYWORDS.has(name)) { return name; }
  }
  return undefined;
}

function functionFromHeader(line: string): string | undefined {
  const context = line.slice(line.indexOf('@@', 2) + 2);
  const names = [...context.matchAll(/([A-Za-z_][A-Za-z_0-9]*)\s*\(/g)]
    .map(match => match[1]).filter(name => !KEYWORDS.has(name));
  return names[0];
}

function singleIdentifierRename(before: string, after: string): string | undefined {
  const tokensBefore = before.match(/[A-Za-z_][A-Za-z_0-9]*|\d+(?:\.\d+)?|\S/g) ?? [];
  const tokensAfter = after.match(/[A-Za-z_][A-Za-z_0-9]*|\d+(?:\.\d+)?|\S/g) ?? [];
  if (tokensBefore.length !== tokensAfter.length) { return undefined; }
  const changed = tokensBefore.flatMap((token, index) => token === tokensAfter[index] ? [] : [index]);
  if (changed.length !== 1) { return undefined; }
  const index = changed[0];
  const oldName = tokensBefore[index];
  const newName = tokensAfter[index];
  return IDENTIFIER.test(oldName) && IDENTIFIER.test(newName) &&
    !KEYWORDS.has(oldName) && !KEYWORDS.has(newName) ? `${oldName}\0${newName}` : undefined;
}

export function analyzeStagedDiff(diff: string): DiffHints {
  if (!diff) { return {}; }
  const functions = new Set<string>();
  const removed: string[] = [];
  const added: string[] = [];
  const hunks: { removed: string[]; added: string[] }[] = [];
  let hunk: { removed: string[]; added: string[] } | undefined;

  for (const line of diff.split('\n')) {
    if (line.startsWith('@@ ')) {
      const name = functionFromHeader(line);
      if (name) { functions.add(name); }
      hunk = { removed: [], added: [] };
      hunks.push(hunk);
    } else if (hunk && line.startsWith('diff --git ')) {
      hunk = undefined;
    } else if (hunk && line.startsWith('-') && !line.startsWith('---')) {
      hunk.removed.push(line.slice(1));
      removed.push(line.slice(1));
    } else if (hunk && line.startsWith('+') && !line.startsWith('+++')) {
      hunk.added.push(line.slice(1));
      added.push(line.slice(1));
    }
  }

  const functionName = functions.size === 1 ? [...functions][0] : undefined;
  const oldDeclarations = new Set(removed.map(declaredFunction).filter((name): name is string => !!name));
  const newDeclarations = new Set(added.map(declaredFunction).filter((name): name is string => !!name));
  const addedFunctions = [...newDeclarations].filter(name => !oldDeclarations.has(name));
  const detectedFunctions = addedFunctions.length >= 1 && addedFunctions.length <= 3 &&
    addedFunctions.length === newDeclarations.size && oldDeclarations.size === 0
    ? addedFunctions : undefined;
  const addedText = added.join('\n');
  const removedText = removed.join('\n');
  for (const line of added) {
    const match = /^\s*(?:(?:export|static|inline)\s+)*(?:const|constexpr)\s+(?:[\w:<>,*&]+\s+)?([A-Za-z_][A-Za-z_0-9]*)\s*=\s*(\d+(?:\.\d+)?)(?:\s*;|\s*$)/.exec(line);
    if (!match) { continue; }
    const [, name, literal] = match;
    const escapedLiteral = literal.replaceAll('.', '\\.');
    const oldUses = removedText.match(new RegExp(`(^|[^\\w.])${escapedLiteral}(?![\\w.])`, 'gm'))?.length ?? 0;
    const newUses = addedText.match(new RegExp(`\\b${name}\\b`, 'g'))?.length ?? 0;
    if (oldUses >= 2 && newUses >= 2) { return { intent: 'named-constant', functionName, addedFunctions: detectedFunctions }; }
  }

  const renameCounts = new Map<string, { count: number; declaration: boolean }>();
  for (const item of hunks) {
    for (const before of item.removed.slice(0, 20)) {
      for (const after of item.added.slice(0, 20)) {
        const rename = singleIdentifierRename(before, after);
        if (rename) {
          const previous = renameCounts.get(rename) ?? { count: 0, declaration: false };
          renameCounts.set(rename, {
            count: previous.count + 1,
            declaration: previous.declaration || /\b(?:const|let|var|int|long|short|char|float|double|bool|boolean|auto|string)\b/.test(before)
          });
        }
      }
    }
  }
  if ([...renameCounts.values()].some(value => value.count >= 2 && value.declaration)) {
    return { intent: 'rename-variables', functionName, addedFunctions: detectedFunctions };
  }
  return { functionName, addedFunctions: detectedFunctions };
}
