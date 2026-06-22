type ResultCallback = (text: string, isFinal: boolean) => void;
type EndCallback = () => void;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let recognition: any = null;
let audioCtx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let micStream: MediaStream | null = null;

export function isSupported(): boolean {
  return 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window;
}

export function getAnalyser(): AnalyserNode | null {
  return analyser;
}

export async function startListening(onResult: ResultCallback, onEnd: EndCallback): Promise<boolean> {
  const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!SR) return false;

  // Setup Web Audio for waveform
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioCtx = new AudioContext();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.8;
    const source = audioCtx.createMediaStreamSource(micStream);
    source.connect(analyser);
  } catch {
    // 音波图不可用，但语音识别仍可继续
  }

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

  recognition.onend = onEnd;
  recognition.onerror = () => onEnd();
  recognition.start();
  return true;
}

export function stopListening(): void {
  if (recognition) { recognition.stop(); recognition = null; }
  if (micStream) { micStream.getTracks().forEach(t => t.stop()); micStream = null; }
  if (audioCtx) { audioCtx.close(); audioCtx = null; }
  analyser = null;
}
