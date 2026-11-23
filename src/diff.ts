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
  return declaredFunction(context) ?? names[0];
}

function singleIdentifierRename(before: string, after: string): string | undefined {
  const tokensBefore = before.match(/[A-Za-z_][A-Za-z_0-9]*|\d+(?:\.\d+)?|\S/g) ?? [];
  const tokensAfter = after.match(/[A-Za-z_][A-Za-z_0-9]*|\d+(?:\.\d+)?|\S/g) ?? [];
  if (tokensBefore.length !== tokensAfter.length) { return undefined; }
  const changed = tokensBefore.flatMap((token, index) => token === tokensAfter[index] ? [] : [index]);
  if (!changed.length) { return undefined; }
  const index = changed[0];
  const oldName = tokensBefore[index];
  const newName = tokensAfter[index];
  if (!changed.every(i => tokensBefore[i] === oldName && tokensAfter[i] === newName)) {
    return undefined;
  }
  return IDENTIFIER.test(oldName) && IDENTIFIER.test(newName) &&
    !KEYWORDS.has(oldName) && !KEYWORDS.has(newName) ? `${oldName}\0${newName}` : undefined;
}

interface ChangedLines {
  removed: string[];
  added: string[];
}

function findRefactors(blocks: ChangedLines[], functionName: string | undefined,
  constants: Map<string, string>): DiffHints[] {
  const hints: DiffHints[] = [];
  const addedText = blocks.flatMap(block => block.added).join('\n');
  const removedText = blocks.flatMap(block => block.removed).join('\n');
  for (const [name, literal] of constants) {
    const escapedLiteral = literal.replaceAll('.', '\\.');
    const oldUses = removedText.match(new RegExp(`(^|[^\\w.])${escapedLiteral}(?![\\w.])`, 'gm'))?.length ?? 0;
    const newUses = addedText.match(new RegExp(`\\b${name}\\b`, 'g'))?.length ?? 0;
    if (oldUses >= 2 && newUses >= 2) {
      hints.push({ intent: 'named-constant', functionName });
      break;
    }
  }

  const renameCounts = new Map<string, { count: number; declaration: boolean; parameter: boolean }>();
  for (const item of blocks) {
    for (const before of item.removed.slice(0, 20)) {
      for (const after of item.added.slice(0, 20)) {
        const rename = singleIdentifierRename(before, after);
        if (rename) {
          const previous = renameCounts.get(rename) ?? { count: 0, declaration: false, parameter: false };
          const args = before.slice(before.indexOf('(') + 1, before.indexOf(')'));
          const identifiers: string[] = args.match(/[A-Za-z_]\w*/g) ?? [];
          const parameter = !!declaredFunction(before) && identifiers.includes(rename.split('\0')[0]);
          renameCounts.set(rename, {
            parameter: previous.parameter || parameter,
            count: previous.count + 1,
            declaration: previous.declaration || parameter || /\b(?:const|let|var|int|long|short|char|float|double|bool|boolean|auto|string)\b/.test(before)
          });
        }
      }
    }
  }
  for (const evidence of renameCounts.values()) {
    if (evidence.count >= 2 && evidence.declaration) {
      hints.push({ intent: 'rename-variables', functionName, parameter: evidence.parameter });
      break;
    }
  }
  return hints;
}

// The caller supplies one staged file at a time. Track the old and new sides
// independently: one hunk may edit a signature and introduce another function.
export function analyzeStagedDiff(diff: string): DiffHints[] {
  const groups = new Map<string, ChangedLines[]>();
  const constants = new Map<string, string>();
  const declarations = { added: new Map<string, string>(), removed: new Map<string, string>() };
  let locations: Record<'added' | 'removed', string> | undefined;
  let blocks = new Map<string, ChangedLines>();
  for (const line of diff.split('\n')) {
    if (line.startsWith('@@ ')) {
      const name = functionFromHeader(line) ?? '';
      locations = { added: name, removed: name };
      blocks = new Map();
      continue;
    }
    if (!locations || !(line.startsWith('+') || line.startsWith('-'))) { continue; }
    const side = line[0] === '+' ? 'added' : 'removed';
    const content = line.slice(1);
    if (!content.trim()) { continue; }
    if (side === 'added') {
      const constant = /^\s*(?:(?:export|static|inline)\s+)*(?:const|constexpr)\s+(?:[\w:<>,*&]+\s+)?([A-Za-z_]\w*)\s*=\s*(\d+(?:\.\d+)?)(?:\s*;|\s*$)/.exec(content);
      if (constant) { constants.set(constant[1], constant[2]); }
    }
    const name = declaredFunction(content);
    if (name) {
      locations[side] = name;
      declarations[side].set(name, content.trim().replace(/\s+/g, ' '));
    }
    const location = locations[side];
    let block = blocks.get(location);
    if (!block) {
      block = { added: [], removed: [] };
      blocks.set(location, block);
      if (!groups.has(location)) { groups.set(location, []); }
      groups.get(location)!.push(block);
    }
    block[side].push(content);
  }

  const removedSignatures = new Set([...declarations.removed]
    .filter(([name]) => !declarations.added.has(name))
    .map(([name, line]) => signatureShape(line, name)));
  const newNames = new Set([...declarations.added.keys()].filter(name => !declarations.removed.has(name)));
  const addedFunctions = [...newNames].filter(name =>
    !removedSignatures.has(signatureShape(declarations.added.get(name)!, name)));
  const hints: DiffHints[] = [];
  if (addedFunctions.length) { hints.push({ addedFunctions }); }
  for (const [location, blocks] of groups) {
    if (newNames.has(location)) { continue; }
    const refactors = findRefactors(blocks, location || undefined, constants);
    if (refactors.length) { hints.push(...refactors); }
    else if (location && declarations.removed.has(location) && !declarations.added.has(location)) {
      // A removed declaration does not identify a surviving function.
      continue;
    } else if (blocks.some(block => [...block.added, ...block.removed].some(line => /[\w]/.test(line)))) {
      hints.push({ functionName: location || undefined });
    }
  }
  return hints;
}

function signatureShape(line: string, name: string): string {
  return line.replace(new RegExp(`\\b${name}(?=\\s*\\()`), '<function>');
}
