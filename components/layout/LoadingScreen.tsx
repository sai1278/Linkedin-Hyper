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
      </div>
    </div>
  );
}
