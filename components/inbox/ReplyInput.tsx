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
  const sendDisabled = !text.trim() || sending || disabled;

  return (
    <div className="inbox-thread-composer shrink-0">
      {templates.length > 0 && (
        <div className="flex flex-wrap gap-2 border-b px-6 pb-3 pt-4 max-[900px]:px-4" style={{ borderColor: 'var(--inbox-thread-divider)' }}>
          {templates.map((template) => (
            <div
              key={template}
              className="inbox-template-chip flex items-center gap-1 rounded-full px-3 py-1.5 text-xs"
              style={{
                backgroundColor: 'var(--inbox-template-bg)',
                color: 'var(--text-primary-new, var(--text-primary))',
              }}
            >
              <button
                type="button"
                onClick={() => setText(template)}
                className="button-ghost rounded-full px-1 py-0.5 text-left"
                aria-label="Use saved reply template"
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

      <div className="flex items-end gap-3 px-6 py-4 max-[900px]:items-stretch max-[900px]:px-4">
        <div className="flex-1">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, MAX_MESSAGE_LENGTH))}
            onKeyDown={handleKeyDown}
            placeholder="Write a message... Press Enter to send or Shift+Enter for a new line."
            aria-label="Message composer"
            disabled={disabled || sending}
            rows={2}
            className="inbox-composer-input w-full min-h-[56px] max-h-[120px] resize-none overflow-y-auto rounded-[22px] px-4 py-3 text-sm leading-6 outline-none transition-colors focus:ring-2 focus:ring-blue-500"
            style={{
              background: 'var(--inbox-input-bg)',
              border: '1px solid var(--inbox-input-border)',
              color: 'var(--inbox-input-text)',
              caretColor: 'var(--accent)',
            }}
          />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={handleSaveTemplate}
              disabled={!text.trim()}
              className="button-ghost inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium"
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
          disabled={sendDisabled}
          aria-label={sending ? 'Sending message' : 'Send message'}
          className="inbox-send-button flex h-12 min-w-[136px] flex-shrink-0 items-center justify-center gap-2 rounded-2xl px-4 text-sm font-semibold transition-colors max-[900px]:min-w-[120px]"
          style={{
            background: sendDisabled ? 'var(--inbox-send-disabled-bg)' : 'var(--accent)',
            color: sendDisabled ? 'var(--text-muted)' : '#fff',
            border: '1px solid',
            borderColor: sendDisabled ? 'var(--inbox-input-border)' : 'var(--accent)',
            cursor: sendDisabled ? 'not-allowed' : 'pointer',
          }}
        >
          <Send size={16} />
          <span>{sending ? 'Sending...' : 'Send'}</span>
        </button>
      </div>
    </div>
  );
}

