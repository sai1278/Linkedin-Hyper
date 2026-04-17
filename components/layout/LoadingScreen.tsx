// FILE: components/layout/LoadingScreen.tsx
export function LoadingScreen() {
  return (
    <div 
      className="h-screen flex items-center justify-center"
      style={{ background: 'var(--bg-base)' }}
    >
      <div className="text-center">
        <div
          className="w-16 h-16 rounded-xl flex items-center justify-center text-white text-2xl font-bold mx-auto mb-4"
          style={{ background: '#0a66c2' }}
        >
          in
        </div>
        <div className="animate-pulse" style={{ color: 'var(--text-muted)' }}>
          Loading...
        </div>
        <noscript>
          <p className="mt-4 max-w-sm text-sm" style={{ color: 'var(--text-primary)' }}>
            This dashboard needs JavaScript for authenticated live views. You can still use the documented API and runbook commands from the server if scripting access is available.
          </p>
        </noscript>
      </div>
    </div>
  );
}
