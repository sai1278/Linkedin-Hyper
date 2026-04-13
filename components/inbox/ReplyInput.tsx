import { useEffect, useRef, useState } from 'react';
import { Send } from 'lucide-react';

interface ReplyInputProps {
  onSend: (text: string) => Promise<void>;
  disabled?: boolean;
}

export function ReplyInput({ onSend, disabled = false }: ReplyInputProps) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!textareaRef.current) return;
    textareaRef.current.style.height = '0px';
    textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 144)}px`;
  }, [text]);

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

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void handleSend();
    }
  }

  const canSend = Boolean(text.trim()) && !sending && !disabled;

  return (
    <div
      className="flex items-end gap-3 px-5 py-4"
      style={{
        borderTop: '1px solid var(--border)',
        background: 'var(--bg-secondary)',
      }}
    >
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Write a message... (Enter to send, Shift+Enter for newline)"
        disabled={disabled || sending}
        rows={1}
        className="flex-1 resize-none rounded-2xl px-4 py-3 text-sm outline-none transition-colors"
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          color: 'var(--text-primary)',
          caretColor: 'var(--accent)',
          lineHeight: 1.45,
          maxHeight: '144px',
        }}
        onFocus={(event) => {
          event.currentTarget.style.borderColor = 'var(--accent)';
          event.currentTarget.style.boxShadow = '0 0 0 3px rgba(24, 119, 242, 0.16)';
        }}
        onBlur={(event) => {
          event.currentTarget.style.borderColor = 'var(--border)';
          event.currentTarget.style.boxShadow = 'none';
        }}
      />

      <button
        onClick={() => void handleSend()}
        disabled={!canSend}
        className="flex items-center justify-center w-11 h-11 rounded-2xl transition-all flex-shrink-0"
        style={{
          background: canSend ? 'var(--accent)' : 'var(--bg-card)',
          color: canSend ? '#ffffff' : 'var(--text-muted)',
          border: '1px solid',
          borderColor: canSend ? 'var(--accent)' : 'var(--border)',
          cursor: canSend ? 'pointer' : 'not-allowed',
          boxShadow: canSend ? 'var(--shadow-sm)' : 'none',
        }}
      >
        <Send size={16} />
      </button>
    </div>
  );
}
