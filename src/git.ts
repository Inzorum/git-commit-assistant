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
