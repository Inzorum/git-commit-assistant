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
