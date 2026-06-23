type ResultCallback = (text: string, isFinal: boolean) => void;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let recognition: any = null;
let audioCtx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let micStream: MediaStream | null = null;
let shouldRestart = false; // 控制是否自动重启

export function isSupported(): boolean {
  return 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window;
}

export function getAnalyser(): AnalyserNode | null {
  return analyser;
}

export async function startListening(onResult: ResultCallback): Promise<boolean> {
  const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!SR) return false;

  // 麦克风 + 音波图
  try {
    if (!micStream) {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioCtx = new AudioContext();
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;
      audioCtx.createMediaStreamSource(micStream).connect(analyser);
    }
  } catch { /* 音波图不可用，不影响识别 */ }

  shouldRestart = true;

  const start = () => {
    recognition = new SR();
    recognition.lang = 'zh-CN';
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (event: any) => {
      let interim = '';
      let final = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript;
        if (event.results[i].isFinal) final += t;
        else interim += t;
      }
      if (final) onResult(final, true);
      else if (interim) onResult(interim, false);
    };

    // 静音停了就自动重启，直到用户手动 stop
    recognition.onend = () => {
      if (shouldRestart) setTimeout(start, 200);
    };

    recognition.onerror = (e: any) => {
      if (e.error !== 'aborted' && shouldRestart) setTimeout(start, 500);
    };

    try { recognition.start(); } catch { /* 已在运行中 */ }
  };

  start();
  return true;
}

export function stopListening(): void {
  shouldRestart = false;
  if (recognition) { recognition.abort(); recognition = null; }
  if (micStream) { micStream.getTracks().forEach(t => t.stop()); micStream = null; }
  if (audioCtx) { audioCtx.close(); audioCtx = null; }
  analyser = null;
}
