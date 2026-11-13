export type Kind = 'exact' | 'equals' | 'contains' | 're' | 'phone';
export interface Entry { kind: Kind; value: string }
export interface Section { any: Entry[]; all: Entry[][]; exclude: Entry[] }
export interface OnForm { mode: 'legacy' | 'all' | 'names'; names: string[] }
export interface DuringForm { enabled: boolean; days: string[]; from: string; to: string }
export interface EmailForm {
  to: Section; subject: Section; body: Section;
  attachment: '' | 'any' | 'none' | 'types'; attachmentTypes: string[];
  larger: string; smaller: string;
  notBulk: boolean; verified: boolean; important: boolean;
  during: DuringForm;
}
export interface RuleForm { name: string; priority: string; on: OnForm; from: Section; message: Section; email: EmailForm }

export interface Provider { id: string; label: string; host: string; port: number; help: string }
export interface TrackerDef {
  id: string; name: string; type: 'whatsapp' | 'email'; enabled: boolean;
  user?: string; provider?: string; host?: string; port?: number; folders?: string[];
  hasPassword?: boolean; account?: { number: string; name: string } | null; hasSession?: boolean;
}
export interface TrackerStatus {
  id: string; name: string; type: string; state: string; error?: string;
  account?: { number: string; name: string }; qr?: string; waState?: string; checkedAt?: number; user?: string;
}
export interface Status {
  pid: number; startedAt: number; state: string; matches: number; lastMatch: number | null;
  running: boolean; methods: string[]; trackers?: TrackerStatus[];
}
export interface MatchItem {
  t: number; rule: string; chat: string; tracker?: string; source?: string; text: string;
  priority?: string; sent?: string[]; failed?: { method: string; error: string }[]; dry?: boolean;
}
export interface AppConfig { notifications: string[]; repeatWindowHours: number; browser: string }
export interface State {
  version: string; apiVersion: number; pid: number; platform: string;
  configFile: string; dataDir: string; profile: string | null; configExists: boolean; configError?: string;
  config: AppConfig | null; rules: RuleForm[]; trackers: TrackerDef[]; providers: Provider[];
  status: Status | null; recentMatches: MatchItem[]; matchTotal: number;
  runAtLogin: boolean; browserFound: string | null; keychain: string;
}
export interface Device { id: string; name: string; addedAt: number }
export interface DevicesInfo { app: string; qr: string; computer: string; devices: Device[] }
export interface Chat { id: string; name: string; group: boolean; phone: string; t: number }

export type Tab = 'overview' | 'notifications' | 'rules' | 'trackers' | 'delivery' | 'settings' | 'advanced' | 'help';

// Settings changed on a page but not yet saved: nothing is applied until the common Save.
export interface Pending {
  notifications?: string[]; repeatWindowHours?: number | string; browser?: string;
  runAtLogin?: boolean; trackers?: TrackerDef[]; passwords?: Record<string, string>;
}
