import type { IconName } from './icons';

// Everything that can be watched. Adding a kind of tracker means one more line here.
export interface TrackerKind { type: 'whatsapp' | 'email'; label: string; icon: IconName }
export const TRACKER_KINDS: TrackerKind[] = [
  { type: 'whatsapp', label: 'WhatsApp', icon: 'chat' },
  { type: 'email', label: 'Email', icon: 'mail' },
];
