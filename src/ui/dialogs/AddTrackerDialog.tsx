import { useState } from 'react';
import { Icon } from '../icons';
import { TRACKER_KINDS, type TrackerKind } from '../trackerTypes';
import { Dialog } from '../ui';

// One place to start adding anything: pick what to watch. A search box appears once the list is long.
export function AddTrackerDialog({ onPick, onClose }: { onPick: (k: TrackerKind) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const shown = TRACKER_KINDS.filter((k) => k.label.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <Dialog onClose={onClose} className="trackerdlg">
      <h3>Add a tracker</h3>
      {TRACKER_KINDS.length > 6 && <input type="text" aria-label="Search trackers" autoFocus value={q} onChange={(e) => setQ(e.target.value)} />}
      <div className="pickrows">
        {shown.map((k) => (
          <button key={k.type} className="pickrow" onClick={() => onPick(k)}>
            <span className="lead"><Icon name={k.icon} size={18} /></span>
            <b>{k.label}</b>
            <Icon name="right" size={16} />
          </button>
        ))}
      </div>
    </Dialog>
  );
}
