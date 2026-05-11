import { useEffect, useRef, useState } from 'react';
import { BookmarkPlus, Send, X } from 'lucide-react';
import toast from 'react-hot-toast';

interface ReplyInputProps {
  onSend: (text: string) => Promise<void>;
  disabled?: boolean;
}

const TEMPLATE_STORAGE_KEY = 'linkedin-hyper:reply-templates';
const MAX_MESSAGE_LENGTH = 800;

export function ReplyInput({ onSend, disabled = false }: ReplyInputProps) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [templates, setTemplates] = useState<string[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    try {
      const stored = window.localStorage.getItem(TEMPLATE_STORAGE_KEY);
      if (!stored) return;

      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        setTemplates(parsed.filter((value): value is string => typeof value === 'string'));
      }
    } catch {
      // Ignore corrupted local storage and keep the composer usable.
    }
  }, []);

  function persistTemplates(nextTemplates: string[]) {
    setTemplates(nextTemplates);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(nextTemplates));
    }
  }

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

  function handleSaveTemplate() {
    const trimmed = text.trim();
    if (!trimmed) {
      toast.error('Write a reply first, then save it as a template.');
      return;
    }

    if (templates.includes(trimmed)) {
      toast('This reply is already saved.', { icon: 'i' });
      return;
    }

    const nextTemplates = [trimmed, ...templates].slice(0, 8);
    persistTemplates(nextTemplates);
    toast.success('Reply saved for quick reuse.');
  }

  function handleRemoveTemplate(template: string) {
    persistTemplates(templates.filter((item) => item !== template));
  }

  const charactersRemaining = MAX_MESSAGE_LENGTH - text.length;

  return (
    <div className="inbox-thread-composer shrink-0">
      {templates.length > 0 && (
        <div className="flex flex-wrap gap-2 border-b px-6 pt-4 pb-3" style={{ borderColor: 'var(--inbox-thread-divider)' }}>
          {templates.map((template) => (
            <div
              key={template}
              className="flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs"
              style={{
                borderColor: 'var(--border)',
                backgroundColor: 'var(--inbox-template-bg)',
                color: 'var(--text-primary-new, var(--text-primary))',
              }}
            >
              <button
                type="button"
                onClick={() => setText(template)}
                className="button-ghost rounded-full px-1 py-0.5 text-left"
              >
                {template.length > 44 ? `${template.slice(0, 44)}...` : template}
              </button>
              <button
                type="button"
                onClick={() => handleRemoveTemplate(template)}
                aria-label="Remove saved reply"
                className="button-ghost flex h-5 w-5 items-center justify-center rounded-full"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-end gap-3 px-6 py-4">
        <div className="flex-1">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, MAX_MESSAGE_LENGTH))}
            onKeyDown={handleKeyDown}
            placeholder="Write a message... (Enter to send, Shift+Enter for newline)"
            aria-label="Message composer"
            disabled={disabled || sending}
            rows={2}
            className="w-full min-h-[88px] resize-none rounded-2xl px-4 py-3 text-sm leading-relaxed outline-none transition-colors focus:ring-2 focus:ring-blue-500"
            style={{
              background: 'var(--inbox-input-bg)',
              border: '1px solid var(--inbox-input-border)',
              color: 'var(--inbox-input-text)',
              caretColor: 'var(--accent)',
            }}
          />
          <div className="mt-2 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={handleSaveTemplate}
              disabled={!text.trim()}
              className="button-ghost inline-flex items-center gap-2 rounded-xl px-3 py-1.5 text-xs font-medium"
            >
              <BookmarkPlus size={14} />
              Save as template
            </button>
            <span
              className="text-xs"
              style={{
                color: charactersRemaining < 80 ? 'var(--color-warning-700)' : 'var(--text-muted-new, var(--text-muted))',
              }}
            >
              {text.length}/{MAX_MESSAGE_LENGTH}
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void handleSend()}
          disabled={!text.trim() || sending || disabled}
          aria-label={sending ? 'Sending message' : 'Send message'}
          className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl transition-colors"
          style={{
            background: text.trim() && !sending ? 'var(--accent)' : 'var(--inbox-send-disabled-bg)',
            color: text.trim() && !sending ? '#fff' : 'var(--text-muted)',
            border: '1px solid',
            borderColor: text.trim() && !sending ? 'var(--accent)' : 'var(--inbox-input-border)',
            cursor: text.trim() && !sending ? 'pointer' : 'not-allowed',
          }}
        >
          <Send size={16} />
        </button>
      </div>
    </div>
  );
}
