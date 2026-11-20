/** The Zwift Companion app on this server, as GET /api/companion reports it. */
export type CompanionStatus = {
  app: {
    versionName: string;
    versionCode: number;
    bytes: number;
    createdAt: string;
    /** False when the server certificate changed since the app was patched. */
    current: boolean;
  } | null;
  tlsMode: 'managed' | 'legacy' | 'custom' | 'disabled';
  /** The address riders point the Zwift names at. */
  serverAddress: string;
};

export type CompanionStep =
  | 'upload'
  | 'runtime'
  | 'editor'
  | 'inspect'
  | 'merge'
  | 'decode'
  | 'patch'
  | 'build'
  | 'sign'
  | 'publish';

export type CompanionActivity = {
  kind: 'toolchain' | 'patch' | 'rekey';
  state: 'running' | 'done' | 'failed';
  steps: CompanionStep[];
  step: CompanionStep;
  progress: number | null;
  message: string | null;
  startedAt: string;
  finishedAt: string | null;
};

/** What the administrator sees, from GET /api/manage/companion. */
export type CompanionAdminStatus = CompanionStatus & {
  toolchain: {
    java: { source: 'managed' | 'system'; command: string; version: string } | null;
    editor: boolean;
    downloadBytes: number;
    supported: boolean;
    folder: string;
  };
  activity: CompanionActivity | null;
  uploadLimit: number;
};
