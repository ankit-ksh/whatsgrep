import { execFileSync } from 'node:child_process';

const SERVICE = 'whatsgrep';

const WIN_VAULT = `
$ErrorActionPreference = 'Stop'
$null = [Windows.Security.Credentials.PasswordVault, Windows.Security.Credentials, ContentType = WindowsRuntime]
$v = New-Object Windows.Security.Credentials.PasswordVault
`;

// The OS's own secret store, driven through its command line tool (no native add-ons, so it
// works from a packaged executable). Secrets go over stdin or env vars, not into the command
// line, except macOS where `security` only takes -w.
// Each backend: get(name) -> string | undefined, set(name, value), del(name). They throw if the
// store is unavailable (e.g. a Linux server with no Secret Service).
export function backendFor(platform = process.platform, run = execFileSync) {
  const exec = (file, args, opts = {}) => run(file, args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...opts });

  if (platform === 'darwin') {
    return {
      name: 'macOS Keychain',
      get: (n) => { try { return exec('security', ['find-generic-password', '-s', SERVICE, '-a', n, '-w']).trim() || undefined; } catch { return undefined; } },
      set: (n, v) => void exec('security', ['add-generic-password', '-U', '-s', SERVICE, '-a', n, '-w', v]),
      del: (n) => { try { exec('security', ['delete-generic-password', '-s', SERVICE, '-a', n]); } catch {} },
    };
  }
  if (platform === 'win32') {
    const ps = (script, env) => exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', WIN_VAULT + script], { env: { ...process.env, ...env } });
    return {
      name: 'Windows Credential Manager',
      get: (n) => {
        try { return ps(`$c = $v.Retrieve('${SERVICE}', $env:WG_NAME); $c.RetrievePassword(); $c.Password`, { WG_NAME: n }).trim() || undefined; } catch { return undefined; }
      },
      set: (n, val) => void ps(`$v.Add((New-Object Windows.Security.Credentials.PasswordCredential('${SERVICE}', $env:WG_NAME, $env:WG_VALUE)))`, { WG_NAME: n, WG_VALUE: val }),
      del: (n) => { try { ps(`$v.Remove($v.Retrieve('${SERVICE}', $env:WG_NAME))`, { WG_NAME: n }); } catch {} },
    };
  }
  return {
    name: 'Secret Service (GNOME Keyring / KWallet)',
    get: (n) => { try { return exec('secret-tool', ['lookup', 'service', SERVICE, 'account', n]).trim() || undefined; } catch { return undefined; } },
    set: (n, v) => void exec('secret-tool', ['store', `--label=${SERVICE} ${n}`, 'service', SERVICE, 'account', n], { input: v }),
    del: (n) => { try { exec('secret-tool', ['clear', 'service', SERVICE, 'account', n]); } catch {} },
  };
}

let backend = backendFor();
export const useBackend = (b) => { backend = b; };
export const storeName = () => backend.name;

export const getSecret = (name) => backend.get(name);
export const deleteSecret = (name) => backend.del(name);

// Returns true when the secret is now in the OS store, false when there is no usable store.
export function setSecret(name, value) {
  try {
    backend.set(name, value);
    return backend.get(name) === value;
  } catch {
    return false;
  }
}
