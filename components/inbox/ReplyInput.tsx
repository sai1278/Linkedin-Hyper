import { useState, useRef } from 'react';
import { Send } from 'lucide-react';

interface ReplyInputProps {
  onSend: (text: string) => Promise<void>;
  disabled?: boolean;
}

export function ReplyInput({ onSend, disabled = false }: ReplyInputProps) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  async function handleSend() {
    const trimmed = text.trim();
    if (!trimmed || sending) return;

    setSending(true);
    try {
      await onSend(trimmed);
      setText('');
      textareaRef.current?.focus();
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  return (
    <div
      className="flex items-end gap-3 px-6 py-4"
      style={{ borderTop: '1px solid var(--border)' }}
    >
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Write a message... (Enter to send, Shift+Enter for newline)"
        disabled={disabled || sending}
        rows={2}
        className="flex-1 resize-none rounded-xl px-4 py-3 text-sm outline-none transition-colors"
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          color: 'var(--text-primary)',
          caretColor: 'var(--accent)',
        }}
        onFocus={(e) => {
          e.currentTarget.style.borderColor = 'var(--accent)';
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderColor = 'var(--border)';
        }}
      />
      <button
        onClick={() => void handleSend()}
        disabled={!text.trim() || sending || disabled}
        className="flex items-center justify-center w-10 h-10 rounded-xl transition-all flex-shrink-0"
        style={{
          background: text.trim() && !sending ? 'var(--accent)' : 'var(--bg-card)',
          color: text.trim() && !sending ? '#fff' : 'var(--text-muted)',
          border: '1px solid',
          borderColor: text.trim() && !sending ? 'var(--accent)' : 'var(--border)',
          cursor: text.trim() && !sending ? 'pointer' : 'not-allowed',
        }}
      >
        <Send size={16} />
      </button>
    </div>
  );
}
