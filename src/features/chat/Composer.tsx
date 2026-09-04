import { useEffect, useRef, useState } from 'react';
import { MAX_UPLOAD_BYTES, uploadImage } from '../../lib/supabase';
import { useSession } from '../../state/session';
import { Icon } from '../../components/Icon';
import { GifPicker, type GifPick } from './GifPicker';

export interface OutgoingMessage {
  kind: 'text' | 'image' | 'gif';
  body: string | null;
  media_url: string | null;
  media_w: number | null;
  media_h: number | null;
}

interface Attachment {
  file: File;
  preview: string;
}

export function Composer({
  onSend,
  onTyping,
  replyTo,
  onCancelReply,
}: {
  onSend: (m: OutgoingMessage) => void;
  onTyping: () => void;
  replyTo: { id: string; label: string } | null;
  onCancelReply: () => void;
}) {
  const { prefs, profile } = useSession();
  const [text, setText] = useState('');
  const [attach, setAttach] = useState<Attachment | null>(null);
  const [gifOpen, setGifOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Grow the box with the text, up to the CSS max-height.
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  }, [text]);

  useEffect(() => {
    if (replyTo) areaRef.current?.focus();
  }, [replyTo]);

  useEffect(() => {
    return () => {
      if (attach) URL.revokeObjectURL(attach.preview);
    };
  }, [attach]);

  const takeFile = (file: File) => {
    if (!file.type.startsWith('image/')) {
      setError('Images only for now.');
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setError('That image is over 8 MB.');
      return;
    }
    setError('');
    setAttach({ file, preview: URL.createObjectURL(file) });
  };

  const send = async () => {
    const body = text.trim();

    if (attach) {
      setUploading(true);
      setError('');
      try {
        const url = await uploadImage(attach.file, 'chat', profile?.id ?? 'anon');
        const dims = await imageSize(attach.preview);
        onSend({
          kind: 'image',
          body: body || null,
          media_url: url,
          media_w: dims.w,
          media_h: dims.h,
        });
        URL.revokeObjectURL(attach.preview);
        setAttach(null);
        setText('');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Upload failed.');
      } finally {
        setUploading(false);
      }
      return;
    }

    if (!body) return;
    onSend({ kind: 'text', body, media_url: null, media_w: null, media_h: null });
    setText('');
  };

  const sendGif = (g: GifPick) => {
    setGifOpen(false);
    onSend({
      kind: 'gif',
      body: null,
      media_url: g.url,
      media_w: g.w || null,
      media_h: g.h || null,
    });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const enterSends = prefs.sendOnEnter ? !e.shiftKey : e.ctrlKey || e.metaKey;
    if (e.key === 'Enter' && enterSends) {
      e.preventDefault();
      void send();
    }
  };

  const canSend = (text.trim().length > 0 || attach !== null) && !uploading;

  return (
    <div
      className="composer"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const f = e.dataTransfer.files[0];
        if (f) takeFile(f);
      }}
    >
      {replyTo && (
        <div className="composer-reply">
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            Replying to {replyTo.label}
          </span>
          <button className="btn btn-ghost btn-sm" onClick={onCancelReply} aria-label="Cancel reply">
            <Icon name="x" size={13} />
          </button>
        </div>
      )}

      {attach && (
        <div className="attach-preview">
          <div className="attach-chip">
            <img src={attach.preview} alt="Attachment preview" />
            <button
              onClick={() => {
                URL.revokeObjectURL(attach.preview);
                setAttach(null);
              }}
              aria-label="Remove attachment"
            >
              <Icon name="x" size={11} strokeWidth={2.4} />
            </button>
          </div>
        </div>
      )}

      {error && <p className="err" style={{ margin: '0 0 8px' }}>{error}</p>}

      <div className="composer-bar" style={{ position: 'relative' }}>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) takeFile(f);
            e.target.value = '';
          }}
        />
        <button
          className="btn btn-icon"
          onClick={() => fileRef.current?.click()}
          title="Attach an image"
          aria-label="Attach an image"
        >
          <Icon name="image" size={17} />
        </button>
        <button
          className="btn btn-icon"
          onClick={() => setGifOpen((v) => !v)}
          title="Send a GIF"
          aria-label="Send a GIF"
        >
          <Icon name="gif" size={18} />
        </button>
        {gifOpen && <GifPicker onPick={sendGif} onClose={() => setGifOpen(false)} />}

        <textarea
          ref={areaRef}
          className="composer-input"
          rows={1}
          placeholder="Message"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            onTyping();
          }}
          onKeyDown={onKeyDown}
          onPaste={(e) => {
            const item = Array.from(e.clipboardData.items).find((i) => i.type.startsWith('image/'));
            const f = item?.getAsFile();
            if (f) {
              e.preventDefault();
              takeFile(f);
            }
          }}
        />

        <button className="send-btn" onClick={() => void send()} disabled={!canSend} aria-label="Send">
          {uploading ? <span className="spinner" /> : <Icon name="send" size={17} />}
        </button>
      </div>
    </div>
  );
}

function imageSize(src: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve({ w: 0, h: 0 });
    img.src = src;
  });
}
