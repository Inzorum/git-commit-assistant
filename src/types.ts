export type ChangeStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'other';
export type FileCategory = 'code' | 'docs' | 'tests' | 'config' | 'other';
export type CommitType = 'feat' | 'fix' | 'docs' | 'test' | 'refactor' | 'chore';
export type CommitFormat = 'auto' | 'conventional' | 'scope' | 'bracket' | 'plain';
export type CommitMode = 'terminalAuto' | 'terminalManual' | 'scm';

export interface StagedChange {
  path: string;
  previousPath?: string;
  status: ChangeStatus;
  additions: number;
  deletions: number;
  binary: boolean;
  category: FileCategory;
}

export interface RepositorySnapshot {
  root: string;
  changes: StagedChange[];
}

export interface AssistantSettings {
  commitMode: CommitMode;
  analyzeDiff: boolean;
  format: CommitFormat;
  language: 'ru' | 'en';
  scopeMode: 'auto' | 'none';
  defaultCodeType: 'chore' | 'feat' | 'fix' | 'refactor';
  maxSubjectLength: number;
  statisticsEnabled: boolean;
  statisticsDays: number;
  showStatisticsAfterSuggestion: boolean;
}

export interface DiffHints {
  intent?: 'named-constant' | 'rename-variables';
  functionName?: string;
  addedFunctions?: string[];
}

export interface MessageSuggestion {
  label: string;
  description: string;
  message: string;
  type: CommitType;
}

export interface AppliedSuggestion {
  timestamp: string;
  repository: string;
  type: CommitType;
  files: number;
  additions: number;
  deletions: number;
}
