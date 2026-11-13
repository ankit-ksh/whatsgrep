import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { CodeEditor } from '../CodeEditor';
import { useApp } from '../store';
import type { State } from '../types';
import { Card, CardHead, IconBtn } from '../ui';

export function Advanced() {
  const { setS, toast, guard } = useApp();
  const [yaml, setYaml] = useState('');
  const [log, setLog] = useState('');
  const logRef = useRef<HTMLPreElement>(null);
  const loadLog = async () => { setLog((await api<{ text: string }>('GET', '/api/log')).text); };
  useEffect(() => { void api<{ text: string }>('GET', '/api/yaml').then((y) => setYaml(y.text)); void loadLog(); }, []);
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [log]);
  return (
    <>
      <Card>
        <CardHead title="Config file" />
        <div className="body">
          <CodeEditor label="Config file" value={yaml} onChange={setYaml} />
          <div className="row-actions" style={{ marginTop: 12 }}>
            <IconBtn icon="check" label="Save file" cls="primary" onClick={guard(async () => { setS(await api<State>('PUT', '/api/yaml', { text: yaml })); toast('Config saved'); })} />
            <IconBtn icon="undo" label="Reload from disk" cls="" onClick={guard(async () => { setYaml((await api<{ text: string }>('GET', '/api/yaml')).text); toast('Reloaded from disk'); })} />
          </div>
        </div>
      </Card>
      <Card>
        <CardHead title="Log" />
        <div className="body">
          <pre className="log" ref={logRef}>{log || 'The log appears here when the tracker was started from this page.'}</pre>
          <div className="row-actions" style={{ marginTop: 12 }}><IconBtn icon="refresh" label="Refresh log" cls="" onClick={guard(loadLog)} /></div>
        </div>
      </Card>
    </>
  );
}
