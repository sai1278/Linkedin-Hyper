// FILE: app/(auth)/login/page.tsx
'use client';

import { useState } from 'react';
import { useAuth } from '@/components/providers/AuthProvider';
import { motion } from 'framer-motion';
import { Eye, EyeOff, Loader2 } from 'lucide-react';

export default function LoginPage() {
  const { login } = useAuth();
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);
    
    try {
      await login(password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setIsLoading(false);
    }
  };
  
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full max-w-md"
    >
      <div 
        className="rounded-xl border p-8"
        style={{ 
          background: 'var(--bg-panel)', 
          borderColor: 'var(--border)' 
        }}
      >
        {/* Logo */}
        <div className="flex justify-center mb-8">
          <div className="flex items-center gap-3">
            <div
              className="w-12 h-12 rounded-lg flex items-center justify-center text-white text-xl font-bold"
              style={{ background: '#0a66c2' }}
            >
              in
            </div>
            <div>
              <div className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
                LinkedIn Hyper-V
              </div>
              <div className="text-sm" style={{ color: 'var(--text-muted)' }}>
                Dashboard Login
              </div>
            </div>
          </div>
        </div>
        
        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>
              Password
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-2 pr-10 rounded-lg border transition-all focus:outline-none focus:ring-2"
                style={{
                  background: 'var(--bg-base)',
                  borderColor: error ? '#ef4444' : 'var(--border)',
                  color: 'var(--text-primary)',
                }}
                placeholder="Enter dashboard password"
                disabled={isLoading}
                autoFocus
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2"
                style={{ color: 'var(--text-muted)' }}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            {error && (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-sm mt-2 text-red-400"
              >
                {error}
              </motion.p>
            )}
          </div>
          
          <button
            type="submit"
            disabled={isLoading || !password}
            className="w-full py-2 rounded-lg font-medium transition-all disabled:opacity-50"
            style={{
              background: 'var(--accent)',
              color: 'white',
            }}
          >
            {isLoading ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 size={18} className="animate-spin" />
                Signing in...
              </span>
            ) : (
              'Sign In'
            )}
          </button>
        </form>
      </div>
    </motion.div>
  );
}
