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
  /** `waiting`: an upload needs the Java tools, and holds until they are downloaded or it is discarded. */
  state: 'running' | 'waiting' | 'done' | 'failed';
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
  /** True while an upload waits for the Java tools. */
  pending: boolean;
  uploadLimit: number;
};

/** A file size as riders read it: whole megabytes, or gigabytes from 1 GB. */
export function megabytes(bytes: number) {
  return bytes >= 1_000_000_000
    ? `${Math.round(bytes / 100_000_000) / 10} GB`
    : `${Math.max(1, Math.round(bytes / 1_000_000))} MB`;
}
