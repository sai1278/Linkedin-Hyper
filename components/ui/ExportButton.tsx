// FILE: components/ui/ExportButton.tsx
// Reusable export button component with CSV and JSON options

'use client';

import { useState } from 'react';
import { Download, FileJson, FileSpreadsheet, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';

interface ExportButtonProps {
  type: 'messages' | 'activity';
  accountId?: string;
  conversationId?: string;
  chatId?: string; // backward-compatible alias
  label?: string;
  variant?: 'default' | 'outline' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
}

export function ExportButton({ 
  type, 
  accountId, 
  conversationId,
  chatId,
  label = 'Export', 
  variant = 'outline',
  size = 'md',
}: ExportButtonProps) {
  const [isExporting, setIsExporting] = useState(false);
  const [showMenu, setShowMenu] = useState(false);

  async function handleExport(format: 'csv' | 'json') {
    setIsExporting(true);
    setShowMenu(false);
    
    try {
      const response = await fetch(`/api/export/${type}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId,
          conversationId: conversationId || chatId,
          format,
        }),
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Export failed');
      }
      
      // Get filename from Content-Disposition header or generate one
      const contentDisposition = response.headers.get('Content-Disposition');
      let filename = `linkedin-${type}-${new Date().toISOString().split('T')[0]}.${format}`;
      
      if (contentDisposition) {
        const filenameMatch = contentDisposition.match(/filename="?(.+)"?/i);
        if (filenameMatch) {
          filename = filenameMatch[1];
        }
      }
      
      // Download file
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      toast.success(`Exported as ${format.toUpperCase()}`, {
        icon: 'ðŸ“¥',
        duration: 3000,
      });
    } catch (error) {
      console.error('[Export] Error:', error);
      toast.error(error instanceof Error ? error.message : 'Export failed. Please try again.', {
        duration: 4000,
      });
    } finally {
      setIsExporting(false);
    }
  }

  const sizeClasses = {
    sm: 'px-3 py-1.5 text-xs',
    md: 'px-4 py-2 text-sm',
    lg: 'px-6 py-3 text-base',
  };

  const variantClasses = {
    default: 'button-primary',
    outline: 'button-outline',
    ghost: 'button-ghost',
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setShowMenu(!showMenu)}
        disabled={isExporting}
        className={`flex items-center gap-2 rounded-lg font-medium ${sizeClasses[size]} ${variantClasses[variant]}`}
        style={{
          cursor: isExporting ? 'not-allowed' : 'pointer',
          opacity: isExporting ? 0.6 : 1,
        }}
      >
        {isExporting ? (
          <Loader2 size={size === 'sm' ? 14 : size === 'lg' ? 20 : 16} className="animate-spin" />
        ) : (
          <Download size={size === 'sm' ? 14 : size === 'lg' ? 20 : 16} />
        )}
        <span>{isExporting ? 'Exporting...' : label}</span>
      </button>

      {/* Dropdown menu */}
      {showMenu && !isExporting && (
        <>
          {/* Backdrop */}
          <div 
            className="fixed inset-0 z-10" 
            onClick={() => setShowMenu(false)}
          />
          
          {/* Menu */}
          <div
            className="absolute right-0 mt-2 w-48 rounded-lg shadow-lg z-20 py-1"
            style={{
              backgroundColor: 'var(--bg-secondary, var(--bg-card))',
              border: '1px solid var(--border)',
            }}
          >
            <button
              type="button"
              onClick={() => handleExport('csv')}
              className="menu-button flex items-center gap-3 px-4 py-2 text-left text-sm"
            >
              <FileSpreadsheet size={16} style={{ color: 'var(--color-success-500, #22c55e)' }} />
              <span>Export as CSV</span>
            </button>
            
            <button
              type="button"
              onClick={() => handleExport('json')}
              className="menu-button flex items-center gap-3 px-4 py-2 text-left text-sm"
            >
              <FileJson size={16} style={{ color: 'var(--color-primary-500, #3b82f6)' }} />
              <span>Export as JSON</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}

