// 讯飞实时语音识别（流式版）
// 文档：https://www.xfyun.cn/doc/asr/voicedictation/API.html

const APPID = import.meta.env.VITE_XFYUN_APPID as string;
const API_KEY = import.meta.env.VITE_XFYUN_API_KEY as string;
const API_SECRET = import.meta.env.VITE_XFYUN_API_SECRET as string;

type ResultCallback = (text: string, isFinal: boolean) => void;

let ws: WebSocket | null = null;
let audioCtx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let micStream: MediaStream | null = null;
let processor: ScriptProcessorNode | null = null;
let shouldRun = false;
let resultBuffer = ''; // 累积识别结果

export function isSupported(): boolean {
  return !!(navigator.mediaDevices?.getUserMedia);
}

export function getAnalyser(): AnalyserNode | null {
  return analyser;
}

// 构建讯飞鉴权 URL
async function buildXfURL(): Promise<string> {
  const host = 'iat-api.xfyun.cn';
  const path = '/v2/iat';
  const date = new Date().toUTCString();
  const signOrigin = `host: ${host}\ndate: ${date}\nGET ${path} HTTP/1.1`;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(API_SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(signOrigin));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)));

  const authOrigin = `api_key="${API_KEY}", algorithm="hmac-sha256", headers="host date request-line", signature="${sigB64}"`;
  const auth = btoa(authOrigin);

  return `wss://${host}${path}?authorization=${encodeURIComponent(auth)}&date=${encodeURIComponent(date)}&host=${host}`;
}

// Float32 → Int16 PCM
function f32ToI16(float32: Float32Array): ArrayBuffer {
  const buf = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    buf[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  return buf.buffer;
}

// ArrayBuffer → base64
function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

// 解析讯飞返回结果
function parseXfResult(data: any): { text: string; isFinal: boolean } {
  try {
    const words: string[] = [];
    (data.data?.result?.ws || []).forEach((w: any) => {
      (w.cw || []).forEach((c: any) => words.push(c.w || ''));
    });
    const isFinal = data.data?.result?.ls === true || data.data?.status === 2;
    return { text: words.join(''), isFinal };
  } catch {
    return { text: '', isFinal: false };
  }
}

async function connectAndStart(onResult: ResultCallback): Promise<void> {
  if (!shouldRun) return;

  const url = await buildXfURL();
  ws = new WebSocket(url);
  let frameCount = 0;

  ws.onopen = () => {
    if (!shouldRun) { ws?.close(); return; }
    // 第一帧：带业务参数
    const firstFrame = {
      common: { app_id: APPID },
      business: {
        domain: 'iat',
        language: 'zh_cn',
        accent: 'mandarin',
        vad_eos: 5000,      // 静音5秒才截断
        dwa: 'wpgs',        // 动态修正，提升实时准确率
      },
      data: { status: 0, format: 'audio/L16;rate=16000', encoding: 'raw', audio: '' },
    };
    ws!.send(JSON.stringify(firstFrame));
    frameCount = 1;
  };

  ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.code !== 0) { console.warn('讯飞错误:', msg.message); return; }
      const { text, isFinal } = parseXfResult(msg);
      if (!text) return;

      if (isFinal) {
        resultBuffer += text;
        onResult(resultBuffer, true);
      } else {
        onResult(resultBuffer + text, false);
      }

      // 最终结果到了，重连开始新一轮（讯飞流式每次最长5分钟）
      if (msg.data?.status === 2) {
        ws?.close();
        if (shouldRun) setTimeout(() => connectAndStart(onResult), 300);
      }
    } catch { /* 忽略解析错误 */ }
  };

  ws.onerror = () => {
    if (shouldRun) setTimeout(() => connectAndStart(onResult), 1000);
  };

  ws.onclose = () => {
    ws = null;
  };

  // 设置音频处理：捕获麦克风 → PCM → WebSocket
  if (!processor && audioCtx && micStream) {
    const source = audioCtx.createMediaStreamSource(micStream);
    processor = audioCtx.createScriptProcessor(4096, 1, 1);

    processor.onaudioprocess = (e) => {
      if (!ws || ws.readyState !== WebSocket.OPEN || !shouldRun) return;
      const pcm = f32ToI16(e.inputBuffer.getChannelData(0));
      const status = frameCount === 0 ? 0 : 1;
      ws.send(JSON.stringify({
        data: { status, format: 'audio/L16;rate=16000', encoding: 'raw', audio: toBase64(pcm) },
      }));
      frameCount++;
    };

    source.connect(processor);
    processor.connect(audioCtx.destination);
  }
}

export async function startListening(onResult: ResultCallback): Promise<boolean> {
  if (!isSupported()) return false;
  shouldRun = true;
  resultBuffer = '';

  // 初始化麦克风
  try {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
    audioCtx = new AudioContext({ sampleRate: 16000 });
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.8;
    audioCtx.createMediaStreamSource(micStream).connect(analyser);
  } catch (e) {
    console.error('麦克风初始化失败:', e);
    return false;
  }

  await connectAndStart(onResult);
  return true;
}

export function stopListening(): void {
  shouldRun = false;

  // 发送结束帧
  if (ws?.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify({ data: { status: 2, format: 'audio/L16;rate=16000', encoding: 'raw', audio: '' } }));
    } catch { /* 忽略 */ }
    setTimeout(() => { ws?.close(); ws = null; }, 500);
  } else {
    ws?.close(); ws = null;
  }

  if (processor) { processor.disconnect(); processor = null; }
  if (micStream) { micStream.getTracks().forEach(t => t.stop()); micStream = null; }
  if (audioCtx) { audioCtx.close(); audioCtx = null; }
  analyser = null;
}
