import React, { useState, useEffect, useRef } from 'react';
import { tutorialSteps, tutorialCandidate } from '../data/tutorialData';
import { evaluateAnswer } from '../services/aiService';
import type { AIEvaluation } from '../types';

interface Props {
  onFinish: () => void;
}

type Phase = 'intro' | 'idle' | 'typing' | 'evaluating' | 'result' | 'done';

const SCORE_EMOJI: Record<number, string> = { 1: '🔴', 2: '🟡', 3: '🟢' };
const SCORE_LABEL: Record<number, string> = { 1: '回答较差', 2: '回答一般', 3: '回答到位' };
const CAT_COLOR: Record<string, string> = {
  '工作经验核实': '#6B7FD7', '月嫂技能': '#4CAF87', '儿童常见问题护理': '#E07B54', '先进育儿意识': '#C45FAE',
};

export default function Tutorial({ onFinish }: Props) {
  const [step, setStep] = useState(-1); // -1 = intro
  const [phase, setPhase] = useState<Phase>('intro');
  const [displayText, setDisplayText] = useState('');
  const [evaluation, setEvaluation] = useState<AIEvaluation | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const current = tutorialSteps[step];
  const isLast = step === tutorialSteps.length - 1;

  // 打字机效果
  const startTyping = () => {
    if (!current) return;
    setDisplayText('');
    setPhase('typing');
    let i = 0;
    const full = current.simulatedAnswer;
    timerRef.current = setInterval(() => {
      i++;
      setDisplayText(full.slice(0, i));
      if (i >= full.length) {
        clearInterval(timerRef.current!);
        // 打完自动触发 AI 评估
        setTimeout(() => startEval(full), 500);
      }
    }, 40); // 40ms 每个字
  };

  const startEval = async (text: string) => {
    setPhase('evaluating');
    try {
      const ev = await evaluateAnswer(
        { id: current.id, category: current.category, text: current.question, answerGuide: '', greenFlags: [], redFlags: [], suggestedFollowUps: [] },
        text,
        tutorialCandidate,
      );
      setEvaluation(ev);
      setPhase('result');
    } catch {
      setPhase('result');
    }
  };

  const nextStep = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    const next = step + 1;
    if (next >= tutorialSteps.length) {
      setPhase('done');
    } else {
      setStep(next);
      setPhase('idle');
      setDisplayText('');
      setEvaluation(null);
    }
  };

  useEffect(() => {
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  // ── 介绍页 ─────────────────────────────────────────────────────────────
  if (step === -1) return (
    <div style={S.overlay}>
      <div style={S.card}>
        <div style={{ fontSize: 52, marginBottom: 16 }}>🎓</div>
        <h2 style={S.title}>新手教程</h2>
        <p style={S.sub}>用 3 道示范题带你走一遍完整流程{'\n'}包含好答案和差答案，看看 AI 怎么分析</p>
        <div style={S.candidateBox}>
          <p style={{ fontSize: 13, color: '#888', marginBottom: 4 }}>本次模拟面试：</p>
          <p style={{ fontWeight: 700, color: '#1A1A2E' }}>{tutorialCandidate.name}</p>
          <p style={{ fontSize: 13, color: '#666' }}>{tutorialCandidate.yearsOfExperience}年经验 · {tutorialCandidate.babiesHandled}个宝宝 · 最长{tutorialCandidate.longestAssignment}个月</p>
        </div>
        <button style={S.primaryBtn} onClick={() => { setStep(0); setPhase('idle'); }}>开始教程 →</button>
        <button style={S.skipBtn} onClick={onFinish}>跳过，直接开始</button>
      </div>
    </div>
  );

  // ── 完成页 ─────────────────────────────────────────────────────────────
  if (phase === 'done') return (
    <div style={S.overlay}>
      <div style={S.card}>
        <div style={{ fontSize: 52, marginBottom: 16 }}>🎉</div>
        <h2 style={S.title}>教程完成！</h2>
        <p style={S.sub}>你已经了解了完整的面试流程{'\n'}可以开始真实面试了</p>
        <div style={{ background: '#F7F8FF', borderRadius: 12, padding: 16, margin: '16px 0', textAlign: 'left' }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: '#6B7FD7', marginBottom: 8 }}>操作要点回顾</p>
          {['点「开始听」开始录音，月嫂说话时自动转录', '录音过程中 AI 会实时给出追问建议', '月嫂说完直接点「下一题」，自动保存并继续', '最后点「生成报告」得到完整评估'].map((tip, i) => (
            <p key={i} style={{ fontSize: 13, color: '#444', lineHeight: 1.8 }}>✓ {tip}</p>
          ))}
        </div>
        <button style={S.primaryBtn} onClick={onFinish}>开始真实面试 →</button>
      </div>
    </div>
  );

  // ── 面试步骤 ───────────────────────────────────────────────────────────
  return (
    <div style={S.overlay}>
      <div style={{ ...S.card, padding: '24px 20px', maxHeight: '85vh', overflowY: 'auto' as const }}>

        {/* 进度 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <span style={{ fontSize: 12, color: '#6B7FD7', fontWeight: 700 }}>教程 {step + 1}/{tutorialSteps.length}</span>
          <div style={{ display: 'flex', gap: 6 }}>
            {tutorialSteps.map((_, i) => (
              <div key={i} style={{ width: 28, height: 4, borderRadius: 2, background: i <= step ? '#6B7FD7' : '#E0E1EE' }} />
            ))}
          </div>
        </div>

        {/* 题目卡 */}
        <div style={{ background: '#F7F8FF', borderRadius: 12, padding: 14, marginBottom: 14 }}>
          <span style={{ ...S.catBadge, background: CAT_COLOR[current.category] }}>{current.category}</span>
          <p style={S.question}>{current.question}</p>
        </div>

        {/* 提示 */}
        <div style={{ background: '#FFFBF0', borderRadius: 10, padding: '10px 14px', marginBottom: 14, borderLeft: '3px solid #F59E0B' }}>
          <p style={{ fontSize: 13, color: '#92400E' }}>{current.hint}</p>
        </div>

        {/* 模拟月嫂回答区 */}
        <div style={{ background: '#F9FAFB', borderRadius: 12, padding: 14, marginBottom: 14, minHeight: 80 }}>
          <p style={{ fontSize: 12, color: '#888', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: phase === 'typing' ? '#E05454' : '#ddd', display: 'inline-block' }} />
            {phase === 'typing' ? '月嫂回答中...' : phase === 'idle' ? '等待月嫂回答' : '转录完成'}
          </p>
          <p style={{ fontSize: 15, color: '#1A1A2E', lineHeight: 1.7 }}>
            {displayText}
            {phase === 'typing' && <span style={{ animation: 'blink 1s infinite', borderRight: '2px solid #333', marginLeft: 1 }}> </span>}
          </p>
        </div>

        {/* AI 评估 */}
        {phase === 'evaluating' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 14, background: '#F7F8FF', borderRadius: 12, marginBottom: 14 }}>
            <div style={S.spinner} />
            <span style={{ fontSize: 14, color: '#6B7FD7' }}>AI 分析中...</span>
          </div>
        )}

        {phase === 'result' && evaluation && (
          <div style={{ background: '#fff', border: '1.5px solid #E0E1EE', borderRadius: 12, padding: 14, marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <span style={{ fontSize: 22 }}>{SCORE_EMOJI[evaluation.score]}</span>
              <span style={{ fontSize: 15, fontWeight: 700 }}>{SCORE_LABEL[evaluation.score]}</span>
            </div>
            {evaluation.highlights.length > 0 && (
              <div style={{ marginBottom: 8 }}>
                <p style={{ fontSize: 12, color: '#2E9B6E', fontWeight: 700, marginBottom: 4 }}>✓ 答到了</p>
                {evaluation.highlights.map((h, i) => <p key={i} style={{ fontSize: 13, color: '#2E7D5A' }}>• {h}</p>)}
              </div>
            )}
            {evaluation.concerns.length > 0 && (
              <div style={{ marginBottom: 8 }}>
                <p style={{ fontSize: 12, color: '#E05454', fontWeight: 700, marginBottom: 4 }}>✗ 需注意</p>
                {evaluation.concerns.map((c, i) => <p key={i} style={{ fontSize: 13, color: '#C04040' }}>• {c}</p>)}
              </div>
            )}
          </div>
        )}

        {/* 操作按钮 */}
        {(phase === 'idle') && (
          <button style={S.primaryBtn} onClick={startTyping}>
            🎭 模拟月嫂回答
          </button>
        )}

        {phase === 'result' && (
          <button style={S.primaryBtn} onClick={nextStep}>
            {isLast ? '查看教程总结 →' : '下一道示范题 →'}
          </button>
        )}

        <button style={S.skipBtn} onClick={onFinish}>跳过教程</button>
      </div>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', inset: 0,
    background: 'rgba(26,26,46,0.7)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 200, padding: 16,
  },
  card: {
    background: '#fff',
    borderRadius: 24,
    padding: '32px 24px',
    width: '100%',
    maxWidth: 420,
    textAlign: 'center',
  },
  title: { fontSize: 22, fontWeight: 800, color: '#1A1A2E', marginBottom: 8 },
  sub: { fontSize: 14, color: '#888', lineHeight: 1.8, marginBottom: 24, whiteSpace: 'pre-line' },
  candidateBox: { background: '#F7F8FF', borderRadius: 12, padding: 14, marginBottom: 20, textAlign: 'left' },
  primaryBtn: {
    display: 'block', width: '100%',
    background: '#6B7FD7', color: '#fff',
    border: 'none', borderRadius: 12,
    padding: '14px 0', fontSize: 15, fontWeight: 700,
    cursor: 'pointer', marginBottom: 10,
  },
  skipBtn: {
    display: 'block', width: '100%',
    background: 'none', border: 'none',
    color: '#aaa', fontSize: 14, cursor: 'pointer',
  },
  catBadge: {
    display: 'inline-block',
    color: '#fff', fontSize: 11, fontWeight: 600,
    padding: '3px 10px', borderRadius: 20, marginBottom: 8,
  },
  question: { fontSize: 15, fontWeight: 600, color: '#1A1A2E', lineHeight: 1.6, textAlign: 'left', marginTop: 6 },
  spinner: {
    width: 20, height: 20,
    border: '3px solid #E0E1EE', borderTopColor: '#6B7FD7',
    borderRadius: '50%', animation: 'spin 0.8s linear infinite',
  },
};
