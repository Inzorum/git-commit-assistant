import * as vscode from 'vscode';

function quoteForShell(value: string): string {
  if (process.platform === 'win32') {
    return `'${value.replaceAll("'", "''")}'`;
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function sendCommitToTerminal(root: string, message: string, execute: boolean): void {
  // A terminal receives keystrokes, so line breaks and control characters must be rejected.
  if (/[\x00-\x1f\x7f]/.test(message)) {
    throw new Error('Сообщение коммита должно быть одной строкой без управляющих символов.');
  }

  // Use a known shell so message quoting cannot depend on the user's terminal profile.
  const terminal = vscode.window.createTerminal({
    name: 'Git Commit Assistant',
    cwd: root,
    shellPath: process.platform === 'win32' ? 'powershell.exe' : '/bin/sh'
  });
  terminal.show();
  terminal.sendText(`git commit -m ${quoteForShell(message)}`, execute);
}
