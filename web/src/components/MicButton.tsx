import { useEffect, useRef, useState } from 'react';
import { fileToAttachment, type Attachment } from '../api.ts';

/**
 * Tap to record a voice note, tap again to stop. The recording is handed to
 * `onAudio` as an attachment; each page sends it to its own Gemini endpoint.
 */
export function MicButton({
  onAudio,
  label,
  text,
  busy = false,
  disabled = false,
}: {
  onAudio: (audio: Attachment) => void | Promise<void>;
  /** Accessible name / tooltip. */
  label: string;
  /** Visible words next to the mic (a pill button); icon-only when omitted. */
  text?: string;
  busy?: boolean;
  disabled?: boolean;
}) {
  const [recording, setRecording] = useState(false);
  const [err, setErr] = useState('');
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);

  // Release the microphone if the page changes mid-recording.
  useEffect(
    () => () => {
      stream.current?.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  async function toggle() {
    if (recording) {
      recorder.current?.stop();
      return;
    }
    setErr('');
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.current = s;
      const rec = new MediaRecorder(s);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      rec.onstop = async () => {
        s.getTracks().forEach((t) => t.stop());
        setRecording(false);
        const blob = new Blob(chunks, { type: rec.mimeType.split(';')[0] || 'audio/webm' });
        if (blob.size < 2000) {
          setErr('That was too short. Tap the mic, speak, then tap again to stop.');
          return;
        }
        await onAudio(await fileToAttachment(blob, 'Voice note'));
      };
      recorder.current = rec;
      rec.start();
      setRecording(true);
      // A voice note is at most a minute.
      window.setTimeout(() => {
        if (rec.state === 'recording') rec.stop();
      }, 60_000);
    } catch {
      setErr('Microphone permission was blocked. You can type instead.');
    }
  }

  return (
    <span className="pl-mic-wrap">
      <button
        type="button"
        className={text ? `btn btn-outline btn-sm pl-mic pl-mic-pill ${recording ? 'rec' : ''}` : `icon-btn pl-mic ${recording ? 'rec' : ''}`}
        aria-label={recording ? 'Stop recording' : label}
        aria-pressed={recording}
        title={recording ? 'Tap to stop' : label}
        disabled={disabled || busy}
        onClick={() => void toggle()}
      >
        {busy ? <span className="pl-mic-spin" aria-hidden /> : <span aria-hidden>{recording ? '■' : '🎙️'}</span>}
        {text && <span aria-hidden>{busy ? 'Listening to it…' : recording ? 'Stop' : text}</span>}
      </button>
      {recording && <span className="pl-mic-live small" role="status">Listening… tap ■ to stop</span>}
      {err && <span className="pl-mic-err small" role="alert">{err}</span>}
    </span>
  );
}
