import { editable, useApp } from './store';
import type { TrackerDef } from './types';

// Changing trackers is staged like every other setting and applied by the common Save.
export function useTrackerEdits() {
  const { S, trackers, stage, ask, pending } = useApp();
  const list = trackers.map(editable);
  const upsert = (def: TrackerDef, pw?: string) => {
    stage('trackers', list.some((t) => t.id === def.id) ? list.map((t) => (t.id === def.id ? def : t)) : [...list, def]);
    if (pw) stage('passwords', { ...(pending.passwords ?? {}), [def.id]: pw });
  };
  const setEnabled = (id: string, on: boolean) => stage('trackers', list.map((x) => (x.id === id ? { ...x, enabled: on } : x)));
  // The tracker as the edit dialog should see it, including whether a password is already there.
  const forDialog = (t: TrackerDef): TrackerDef => {
    const saved = S.trackers.find((x) => x.id === t.id);
    return { ...t, ...(saved && { hasPassword: saved.hasPassword || !!pending.passwords?.[t.id] }) };
  };
  const remove = async (t: TrackerDef): Promise<boolean> => {
    if (!(await ask({ title: `Remove “${t.name}”?`, body: 'It stops being watched once you save, and any password saved for it is deleted. Rules that listened to it stay, but match nothing.', ok: 'Remove', danger: true }))) return false;
    stage('trackers', list.filter((x) => x.id !== t.id));
    return true;
  };
  return { list, upsert, setEnabled, forDialog, remove };
}
