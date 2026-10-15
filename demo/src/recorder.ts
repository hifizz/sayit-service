import { useCallback, useRef, useState } from "react";

export interface RecordedClip {
  file: File;
  url: string;
  durationMs: number;
}

const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
];

function pickMime(): { mime: string; ext: string } {
  for (const mime of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(mime)) {
      // 服务端按扩展名识别容器；audio/mp4 用 .m4a
      return { mime, ext: mime.startsWith("audio/mp4") ? "m4a" : mime.startsWith("audio/ogg") ? "ogg" : "webm" };
    }
  }
  return { mime: "", ext: "webm" };
}

export function useRecorder(onError: (message: string) => void) {
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const startedRef = useRef(0);
  const streamRef = useRef<MediaStream | null>(null);

  const cleanup = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
    setRecording(false);
  }, []);

  const start = useCallback(async (): Promise<boolean> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const { mime, ext } = pickMime();
      const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      // 把容器扩展名挂在实例上，stop 时用于命名
      (recorder as MediaRecorder & { __ext?: string }).__ext = ext;
      chunksRef.current = [];
      startedRef.current = performance.now();
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.start(250);
      recorderRef.current = recorder;
      setRecording(true);
      return true;
    } catch (e) {
      cleanup();
      onError(e instanceof Error ? `无法访问麦克风：${e.message}` : "无法访问麦克风");
      return false;
    }
  }, [cleanup, onError]);

  const stop = useCallback(
    (): Promise<RecordedClip | null> =>
      new Promise((resolve) => {
        const recorder = recorderRef.current;
        if (!recorder || recorder.state === "inactive") {
          cleanup();
          resolve(null);
          return;
        }
        const ext = (recorder as MediaRecorder & { __ext?: string }).__ext ?? "webm";
        const durationMs = Math.round(performance.now() - startedRef.current);
        recorder.onstop = () => {
          const type = recorder.mimeType || "audio/webm";
          const blob = new Blob(chunksRef.current, { type });
          cleanup();
          if (!blob.size) {
            resolve(null);
            return;
          }
          const file = new File([blob], `sayit-${Date.now()}.${ext}`, { type });
          resolve({ file, url: URL.createObjectURL(blob), durationMs });
        };
        recorder.stop();
      }),
    [cleanup]
  );

  return { recording, start, stop };
}
