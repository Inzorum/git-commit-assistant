import * as path from 'node:path';
import * as vscode from 'vscode';
import { putMessageIntoScm, readRecentCommitSubjects, readStagedChanges, readStagedCodeDiff, selectRepository } from './git';
import { analyzeStagedDiff } from './diff';
import { StatisticsStore } from './statistics';
import { buildSuggestions } from './suggestions';
import { sendCommitToTerminal } from './terminal';
import type { AssistantSettings } from './types';

function getSettings(root: string): AssistantSettings {
  const configuration = vscode.workspace.getConfiguration('gitCommitAssistant', vscode.Uri.file(root));
  return {
    commitMode: configuration.get<AssistantSettings['commitMode']>('commitMode', 'terminalAuto'),
    analyzeDiff: configuration.get('analyzeDiff', true),
    format: configuration.get<AssistantSettings['format']>('format', 'auto'),
    language: configuration.get<AssistantSettings['language']>('language', 'en'),
    scopeMode: configuration.get<AssistantSettings['scopeMode']>('scopeMode', 'auto'),
    defaultCodeType: configuration.get<AssistantSettings['defaultCodeType']>('defaultCodeType', 'chore'),
    maxSubjectLength: configuration.get('maxSubjectLength', 72),
    statisticsEnabled: configuration.get('statisticsEnabled', true),
    statisticsDays: configuration.get('statisticsDays', 14),
    showStatisticsAfterSuggestion: configuration.get('showStatisticsAfterSuggestion', false)
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function activate(context: vscode.ExtensionContext): void {
  const statistics = new StatisticsStore(context);

  const suggest = vscode.commands.registerCommand('gitCommitAssistant.suggest', async () => {
    const root = await selectRepository();
    if (!root) { return; }
    try {
      const snapshot = await readStagedChanges(root);
      if (!snapshot.changes.length) {
        vscode.window.showInformationMessage('Нет подготовленных изменений. Добавьте файлы в Git Staging и попробуйте снова.');
        return;
      }

      const settings = getSettings(root);
      const [history, diff] = await Promise.all([
        settings.format === 'auto' ? readRecentCommitSubjects(root) : Promise.resolve([]),
        settings.analyzeDiff ? readStagedCodeDiff(root, snapshot.changes) : Promise.resolve('')
      ]);
      const suggestions = buildSuggestions(snapshot.changes, settings, history, analyzeStagedDiff(diff));
      const picked = await vscode.window.showQuickPick(suggestions, {
        placeHolder: `Выберите предложение для ${snapshot.changes.length} подготовленных файлов`
      });
      if (!picked) { return; }

      const edited = await vscode.window.showInputBox({
        title: 'Проверьте сообщение коммита',
        prompt: 'Локальные правила не определяют смысл правки. Уточните текст при необходимости.',
        value: picked.message,
        ignoreFocusOut: true,
        validateInput: value => value.trim() ? undefined : 'Сообщение не может быть пустым.'
      });
      if (edited === undefined) { return; }

      const message = edited.trim();
      let applied = false;
      if (settings.commitMode === 'scm') {
        applied = await putMessageIntoScm(root, message);
      } else {
        sendCommitToTerminal(root, message, settings.commitMode === 'terminalAuto');
        applied = true;
      }
      if (applied && settings.statisticsEnabled) {
        await statistics.record({
          timestamp: new Date().toISOString(),
          repository: root,
          type: picked.type,
          files: snapshot.changes.length,
          additions: snapshot.changes.reduce((sum, change) => sum + change.additions, 0),
          deletions: snapshot.changes.reduce((sum, change) => sum + change.deletions, 0)
        });
      }
      if (applied && settings.commitMode === 'scm') {
        vscode.window.showInformationMessage(`Сообщение для ${path.basename(root)} вставлено в поле Git.`);
      } else if (applied && settings.commitMode === 'terminalManual') {
        vscode.window.showInformationMessage('Команда готова в терминале. Проверьте её и нажмите Enter.');
      }
      if (settings.showStatisticsAfterSuggestion) {
        statistics.show(snapshot, settings.statisticsDays);
      }
    } catch (error) {
      vscode.window.showErrorMessage(`Git Commit Assistant: ${errorMessage(error)}`);
    }
  });

  const showStatistics = vscode.commands.registerCommand('gitCommitAssistant.showStatistics', async () => {
    const root = await selectRepository();
    if (!root) { return; }
    try {
      const snapshot = await readStagedChanges(root);
      statistics.show(snapshot, getSettings(root).statisticsDays);
    } catch (error) {
      vscode.window.showErrorMessage(`Git Commit Assistant: ${errorMessage(error)}`);
    }
  });

  const openSettings = vscode.commands.registerCommand('gitCommitAssistant.openSettings', async () => {
    await vscode.commands.executeCommand('workbench.action.openSettings', 'gitCommitAssistant');
  });

  context.subscriptions.push(suggest, showStatistics, openSettings);
  console.log('Git Commit Assistant активирован');
}

export function deactivate(): void {
  console.log('Git Commit Assistant деактивирован');
}
