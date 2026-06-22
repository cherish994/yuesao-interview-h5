import React, { useEffect, useRef } from 'react';
import { getAnalyser } from '../services/speechService';

interface Props {
  active: boolean;
}

export default function Waveform({ active }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;

    if (!active) {
      ctx.clearRect(0, 0, W, H);
      // 静止时画一条细线
      ctx.strokeStyle = '#D0D3EE';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, H / 2);
      ctx.lineTo(W, H / 2);
      ctx.stroke();
      return;
    }

    const draw = () => {
      const analyser = getAnalyser();
      ctx.clearRect(0, 0, W, H);

      if (!analyser) {
        // 无音频分析器时画脉冲动画
        const t = Date.now() / 300;
        ctx.strokeStyle = '#6B7FD7';
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let x = 0; x < W; x++) {
          const y = H / 2 + Math.sin(x / 12 + t) * 10 * Math.sin(t * 0.7);
          x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.stroke();
      } else {
        const bufLen = analyser.frequencyBinCount;
        const data = new Uint8Array(bufLen);
        analyser.getByteTimeDomainData(data);

        ctx.strokeStyle = '#6B7FD7';
        ctx.lineWidth = 2;
        ctx.beginPath();
        const sliceW = W / bufLen;
        let x = 0;
        for (let i = 0; i < bufLen; i++) {
          const v = data[i] / 128.0;
          const y = (v * H) / 2;
          i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
          x += sliceW;
        }
        ctx.lineTo(W, H / 2);
        ctx.stroke();
      }

      rafRef.current = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(rafRef.current);
  }, [active]);

  return (
    <canvas
      ref={canvasRef}
      width={560}
      height={80}
      style={{ width: '100%', height: '0.8rem', display: 'block' }}
    />
  );
}
