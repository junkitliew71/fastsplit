export function getSessionId(): string {
  let id = localStorage.getItem('fastsplit-session');
  if (!id || !/^fs_[a-f0-9]{64}$/.test(id)) {
    id = 'fs_' + Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2,'0')).join('');
    localStorage.setItem('fastsplit-session',id);
  }
  return id;
}
