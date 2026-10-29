import { execFile } from 'node:child_process';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { categorizePath } from './suggestions';
import type { ChangeStatus, RepositorySnapshot, StagedChange } from './types';

function runGit(folder: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', ['-C', folder, ...args], {
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024
    }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr.trim() || error.message));
      } else {
        resolve(stdout);
      }
    });
  });
}

function statusOf(token: string): ChangeStatus {
  switch (token[0]) {
    case 'A': return 'added';
    case 'M': return 'modified';
    case 'D': return 'deleted';
    case 'R': return 'renamed';
    case 'C': return 'copied';
    default: return 'other';
  }
}

export function parseNameStatus(output: string): StagedChange[] {
  const fields = output.split('\0');
  const changes: StagedChange[] = [];

  for (let i = 0; i < fields.length && fields[i];) {
    const status = statusOf(fields[i++]);
    const firstPath = fields[i++];
    if (!firstPath) { break; }
    const renamed = status === 'renamed' || status === 'copied';
    const currentPath = renamed ? fields[i++] : firstPath;
    if (!currentPath) { break; }
    changes.push({
      path: currentPath,
      previousPath: renamed ? firstPath : undefined,
      status,
      additions: 0,
      deletions: 0,
      binary: false,
      category: categorizePath(currentPath)
    });
  }

  return changes;
}

export function attachNumstat(changes: StagedChange[], output: string): void {
  const byPath = new Map(changes.map(change => [change.path, change]));
  const fields = output.split('\0');

  for (let i = 0; i < fields.length && fields[i];) {
    const match = /^(\d+|-)\t(\d+|-)\t(.*)$/s.exec(fields[i++]);
    if (!match) { continue; }
    // With -z, Git writes renames as "add<TAB>delete<TAB><NUL>old<NUL>new<NUL>".
    let currentPath = match[3];
    if (!currentPath) {
      i++; // previous path
      currentPath = fields[i++];
    }
    const change = byPath.get(currentPath);
    if (!change) { continue; }
    change.binary = match[1] === '-' || match[2] === '-';
    change.additions = change.binary ? 0 : Number(match[1]);
    change.deletions = change.binary ? 0 : Number(match[2]);
  }
}

export async function selectRepository(): Promise<string | undefined> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) {
    vscode.window.showWarningMessage('Откройте папку Git-проекта в VS Code.');
    return undefined;
  }

  const roots = new Set<string>();
  for (const folder of folders) {
    try {
      roots.add((await runGit(folder.uri.fsPath, ['rev-parse', '--show-toplevel'])).trim());
    } catch {
      // A workspace may contain folders that are not Git repositories.
    }
  }

  if (!roots.size) {
    vscode.window.showWarningMessage('В открытых папках не найден Git-репозиторий.');
    return undefined;
  }
  if (roots.size === 1) { return [...roots][0]; }

  const picked = await vscode.window.showQuickPick(
    [...roots].map(root => ({ label: path.basename(root), description: root, root })),
    { placeHolder: 'Выберите репозиторий для анализа' }
  );
  return picked?.root;
}
