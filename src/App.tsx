import React, { useState, useRef, useCallback, useEffect } from 'react';
import { questions } from './data/questionBank';
import { evaluateAnswer, generateReport, getRealtimeFollowUp } from './services/aiService';
import { startListening, stopListening, isSupported, resetBuffer } from './services/speechService';
import { loadSessions as dbLoad, saveSession as dbSave, deleteSession as dbDelete, getUserCredits, redeemCode, getStoredPhone, storePhone, clearPhone } from './services/supabaseService';
import Auth from './components/Auth';
import Waveform from './components/Waveform';
import type {
  CandidateProfile, AnswerRecord, AIEvaluation,
  InterviewSession, InterviewReport, Category,
} from './types';
import styles from './App.module.scss';

const SCORE_EMOJI: Record<number, string> = { 1: '🔴', 2: '🟡', 3: '🟢' };
const SCORE_LABEL: Record<number, string> = { 1: '回答较差', 2: '回答一般', 3: '回答到位' };
const RECO_COLOR: Record<string, string> = {
  '强烈推荐': '#2E9B6E', '推荐': '#4CAF87', '谨慎考虑': '#D4880A', '不推荐': '#E05454',
};
const CAT_COLOR: Record<string, string> = {
  '工作经验核实': '#6B7FD7', '月嫂技能': '#4CAF87', '儿童常见问题护理': '#E07B54', '先进育儿意识': '#C45FAE',
};
const CATS: Category[] = ['工作经验核实', '月嫂技能', '儿童常见问题护理', '先进育儿意识'];

type View = 'home' | 'setup' | 'interview' | 'report';
type Phase = 'idle' | 'listening' | 'processing' | 'result';

export default function App() {
  const [view, setView] = useState<View>('home');
  const [sessions, setSessions] = useState<InterviewSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [session, setSession] = useState<InterviewSession | null>(null);
  const [phone, setPhone] = useState(getStoredPhone);
  const [credits, setCredits] = useState<number | null>(null);
  const [showRedeem, setShowRedeem] = useState(false);
  const [redeemInput, setRedeemInput] = useState('');
  const [redeemMsg, setRedeemMsg] = useState('');
  const [redeemLoading, setRedeemLoading] = useState(false);

  const refreshSessions = () => {
    setSessionsLoading(true);
    dbLoad().then(data => { setSessions(data); setSessionsLoading(false); })
            .catch(() => setSessionsLoading(false));
    if (phone) getUserCredits(phone).then(c => setCredits(c.remaining));
  };

  const handleRedeem = async () => {
    if (!redeemInput.trim()) return;
    setRedeemLoading(true); setRedeemMsg('');
    const result = await redeemCode(phone, redeemInput);
    setRedeemLoading(false);
    if (result.ok) {
      setRedeemMsg(`✅ 兑换成功！解锁 ${result.credits} 次面试`);
      setRedeemInput('');
      getUserCredits(phone).then(c => setCredits(c.remaining));
    } else {
      setRedeemMsg(`❌ ${result.error}`);
    }
  };

  useEffect(() => {
    if (phone) refreshSessions();
  }, [phone]);

  useEffect(() => {
    if (view !== 'interview') stopListening();
  }, [view]);
  const [qIdx, setQIdx] = useState(0);
  const [answers, setAnswers] = useState<AnswerRecord[]>([]);
  const [phase, setPhase] = useState<Phase>('idle');
  const [transcript, setTranscript] = useState('');
  const [evalResult, setEvalResult] = useState<AIEvaluation | null>(null);
  const [followUp, setFollowUp] = useState(false);
  const [followUpText, setFollowUpText] = useState<string | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const [report, setReport] = useState<InterviewReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const [name, setName] = useState('');
  const [yrs, setYrs] = useState('');
  const [babies, setBabies] = useState('');
  const [longest, setLongest] = useState('');

  const finalRef = useRef('');
  const [autoFollowUp, setAutoFollowUp] = useState<string | null>(null);
  const followUpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const qIdxRef = useRef(qIdx); // 用 ref 追踪当前题目，避免闭包问题
  const q = questions[qIdx];
  qIdxRef.current = qIdx;
  const answered = answers.filter(a => !a.skipped && a.transcript).length;

  const resetInterview = () => {
    setQIdx(0); setAnswers([]); setPhase('idle'); setTranscript('');
    setEvalResult(null); setFollowUp(false); setFollowUpText(null); setGuideOpen(false); setErr('');
  };

  const goHome = () => {
    stopListening();
    setView('home');
    refreshSessions();
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('删除这条面试记录？')) return;
    await dbDelete(id);
    setSessions(prev => prev.filter(s => s.id !== id));
  };

  const saveAndUpdate = (sess: InterviewSession, ans: AnswerRecord[]) => {
    const updated = { ...sess, answers: ans };
    setSession(updated);
    dbSave(updated);
    return updated;
  };

  const beginInterview = () => {
    if (!name.trim()) { setErr('请填写月嫂姓名'); return; }
    const candidate: CandidateProfile = {
      name: name.trim(), yearsOfExperience: parseInt(yrs) || 0,
      babiesHandled: parseInt(babies) || 0, longestAssignment: parseInt(longest) || 0,
    };
    const sess: InterviewSession = { id: `s${Date.now()}`, candidate, startedAt: new Date().toISOString(), answers: [] };
    setSession(sess);
    dbSave(sess);
    resetInterview();
    setView('interview');
  };

  const handleListen = async () => {
    finalRef.current = '';
    resetBuffer();
    setTranscript('');
    if (!isSupported()) { setErr('请用 Safari 或 Chrome 打开'); return; }
    const ok = await startListening(
      (text, isFinal) => {
        if (isFinal) {
          finalRef.current += text;
          // 有新的完整句子，防抖 2 秒后触发追问分析
          if (followUpTimerRef.current) clearTimeout(followUpTimerRef.current);
          followUpTimerRef.current = setTimeout(async () => {
            const hint = await getRealtimeFollowUp(q.text, finalRef.current);
            setAutoFollowUp(hint);
          }, 2000);
        }
        setTranscript((finalRef.current + text).slice(-200));
      },
    );
    if (ok) setPhase('listening');
  };

  // 后台静默保存当前题目的转录，返回最新 answers
  const autoSaveCurrentAnswer = useCallback(async (): Promise<AnswerRecord[]> => {
    const text = finalRef.current.trim();
    if (!text || !session) return answers;
    const rec: AnswerRecord = {
      questionId: q.id, transcript: text, evaluation: null,
      followUpTranscripts: answers.find(a => a.questionId === q.id)?.followUpTranscripts || [],
      skipped: false,
    };
    const newAns = [...answers.filter(a => a.questionId !== q.id), rec];
    setAnswers(newAns);
    saveAndUpdate(session, newAns);
    // 后台评估，不阻塞
    evaluateAnswer(q, text, session.candidate).then(ev => {
      const updated = newAns.map(a => a.questionId === q.id ? { ...a, evaluation: ev } : a);
      setAnswers(updated);
      saveAndUpdate(session, updated);
    }).catch(() => {});
    return newAns;
  }, [q, answers, session]);

  // 手动停止并立即评估（显示结果卡）
  const evalAnswer = useCallback(async () => {
    stopListening();
    const text = finalRef.current;
    if (!text.trim()) { setPhase('idle'); return; }
    setPhase('processing');
    setErr('');
    try {
      const ev = await evaluateAnswer(q, text, session!.candidate);
      setEvalResult(ev);
      setPhase('result');
      const rec: AnswerRecord = {
        questionId: q.id, transcript: text, evaluation: ev,
        followUpTranscripts: answers.find(a => a.questionId === q.id)?.followUpTranscripts || [],
        skipped: false,
      };
      const newAns = [...answers.filter(a => a.questionId !== q.id), rec];
      setAnswers(newAns);
      saveAndUpdate(session!, newAns);
    } catch (e: any) {
      setErr(e.message || 'AI 评估失败'); setPhase('idle');
    }
  }, [q, session, answers, phase]);

  const handleFollowUpStop = async () => {
    stopListening();
    const text = finalRef.current;
    if (text) {
      const newAns = answers.map(a =>
        a.questionId === q.id ? { ...a, followUpTranscripts: [...a.followUpTranscripts, text] } : a,
      );
      setAnswers(newAns);
      saveAndUpdate(session!, newAns);
    }
    setFollowUp(false); setPhase('result');
  };

  const skip = () => {
    // 跳过：清空当前转录，不保存
    finalRef.current = '';
    resetBuffer();
    setTranscript('');
    if (qIdx < questions.length - 1) {
      setQIdx(i => i + 1);
      if (phase !== 'listening') setPhase('idle');
      setEvalResult(null); setFollowUp(false); setFollowUpText(null); setGuideOpen(false);
      clearAutoFollowUp();
    }
  };

  const clearAutoFollowUp = () => {
    setAutoFollowUp(null);
    if (followUpTimerRef.current) clearTimeout(followUpTimerRef.current);
  };

  const switchQuestion = async (direction: 1 | -1) => {
    const newIdx = qIdx + direction;
    if (newIdx < 0 || newIdx >= questions.length) return;
    await autoSaveCurrentAnswer();
    resetBuffer();           // 清空讯飞累积文字
    finalRef.current = '';   // 清空本地累积
    setQIdx(newIdx);
    setTranscript('');
    setEvalResult(null); setFollowUp(false); setFollowUpText(null); setGuideOpen(false);
    clearAutoFollowUp();
    // 切题后始终确保录音运行
    if (phase === 'listening') {
      // 已在录：只重置内容，Speech API 持续运行
    } else {
      // 未在录：重新开始
      setPhase('listening');
      startListening((text, isFinal) => {
        if (isFinal) {
          finalRef.current += text;
          if (followUpTimerRef.current) clearTimeout(followUpTimerRef.current);
          followUpTimerRef.current = setTimeout(async () => {
            const hint = await getRealtimeFollowUp(questions[qIdxRef.current].text, finalRef.current);
            setAutoFollowUp(hint);
          }, 2000);
        }
        setTranscript((finalRef.current + text).slice(-200));
      });
    }
  };

  const nextQ = () => switchQuestion(1);
  const prevQ = () => switchQuestion(-1);

  const finish = async () => {
    const freshAnswers = await autoSaveCurrentAnswer(); // 先保存最后一题
    stopListening();
    setLoading(true); setView('report'); setReport(null); setErr('');
    try {
      const r = await generateReport(session!.candidate, freshAnswers);
      setReport(r);
      setAnswers(freshAnswers);
      const updated: InterviewSession = { ...session!, finishedAt: new Date().toISOString(), answers: freshAnswers, report: r };
      setSession(updated);
      await dbSave(updated);
      refreshSessions();
    } catch (e: any) {
      setErr(e.message || '报告生成失败');
    } finally { setLoading(false); }
  };

  if (!phone) return <Auth onLogin={p => { storePhone(p); setPhone(p); }} />;

  if (view === 'home') return (
    <div className={styles.screen}>
      <div className={styles.homeTop}>
        <h1 className={styles.appTitle}>月嫂面试助手</h1>
        <p className={styles.appSub}>AI 实时出题 · 追问 · 生成报告</p>
        <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <span style={{ color: 'rgba(255,255,255,0.75)', fontSize: 13 }}>{phone}</span>
          <button onClick={() => { clearPhone(); setPhone(''); setSessions([]); }}
            style={{ background: 'rgba(255,255,255,0.2)', border: 'none', color: '#fff', fontSize: 12, borderRadius: 20, padding: '4px 12px', cursor: 'pointer' }}>
            切换账号
          </button>
        </div>
      </div>
      {/* 次数显示 */}
      {credits !== null && (
        <div style={{ textAlign: 'center', margin: '12px 0 4px', fontSize: 13, color: credits > 0 ? '#6B7FD7' : '#E05454' }}>
          {credits > 0 ? `剩余 ${credits} 次面试` : '次数已用完'}
        </div>
      )}

      <button className={styles.startBtn} onClick={() => {
        if (credits !== null && credits <= 0) { setShowRedeem(true); return; }
        setName(''); setYrs(''); setBabies(''); setLongest(''); setErr(''); setView('setup');
      }}>
        {credits !== null && credits <= 0 ? '购买次数' : '＋ 开始新面试'}
      </button>

      {/* 兑换码弹窗 */}
      {showRedeem && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 100 }}
          onClick={() => setShowRedeem(false)}>
          <div style={{ background: '#fff', borderRadius: '20px 20px 0 0', padding: 28, width: '100%', maxWidth: 480 }}
            onClick={e => e.stopPropagation()}>
            <p style={{ fontWeight: 700, fontSize: 17, marginBottom: 8 }}>兑换使用次数</p>
            <p style={{ fontSize: 13, color: '#888', marginBottom: 20 }}>购买后联系我获取兑换码</p>
            <input
              style={{ display: 'block', width: '100%', border: '1.5px solid #E0E1EE', borderRadius: 10, padding: '12px 16px', fontSize: 15, letterSpacing: 3, textAlign: 'center', boxSizing: 'border-box' as const, marginBottom: 8 }}
              placeholder="输入兑换码（如 YUESAO-ABCD）"
              value={redeemInput}
              onChange={e => { setRedeemInput(e.target.value.toUpperCase()); setRedeemMsg(''); }}
            />
            {redeemMsg && <p style={{ fontSize: 13, textAlign: 'center', marginBottom: 8, color: redeemMsg.startsWith('✅') ? '#2E9B6E' : '#E05454' }}>{redeemMsg}</p>}
            <button onClick={handleRedeem} disabled={redeemLoading}
              style={{ display: 'block', width: '100%', background: '#6B7FD7', color: '#fff', border: 'none', borderRadius: 10, padding: '14px 0', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>
              {redeemLoading ? '验证中...' : '立即兑换'}
            </button>
            <button onClick={() => setShowRedeem(false)}
              style={{ display: 'block', width: '100%', background: 'none', border: 'none', color: '#888', fontSize: 14, marginTop: 10, cursor: 'pointer' }}>
              关闭
            </button>
          </div>
        </div>
      )}
      {sessionsLoading && <p style={{ textAlign: 'center', color: '#aaa', padding: '0.4rem', fontSize: '0.26rem' }}>加载历史记录...</p>}
      {!sessionsLoading && sessions.length > 0 && <>
        <p className={styles.secLabel}>历史记录</p>
        {sessions.map(s => (
          <div key={s.id} className={styles.sessCard} onClick={() => {
            if (s.report) { setSession(s); setAnswers(s.answers); setReport(s.report); setView('report'); }
          }}>
            <div style={{ flex: 1 }}>
              <div className={styles.sessName}>{s.candidate.name}</div>
              <div className={styles.sessMeta}>{new Date(s.startedAt).toLocaleDateString('zh-CN')} · 答{s.answers.filter(a => !a.skipped && a.transcript).length}/{questions.length}题</div>
            </div>
            {s.report
              ? <span className={styles.recoBadge} style={{ color: RECO_COLOR[s.report.recommendation], background: RECO_COLOR[s.report.recommendation] + '18' }}>{s.report.recommendation}</span>
              : <span className={styles.ingBadge}>进行中</span>
            }
            <button onClick={e => handleDelete(s.id, e)}
              style={{ background: 'none', border: 'none', color: '#ccc', fontSize: 20, cursor: 'pointer', padding: '0 0 0 8px', lineHeight: 1 }}>
              🗑
            </button>
          </div>
        ))}
      </>}
    </div>
  );

  if (view === 'setup') return (
    <div className={styles.screen}>
      <div className={styles.bar}><button className={styles.backBtn} onClick={goHome}>← 返回</button><span>新建面试</span></div>
      <div className={styles.card}>
        <p className={styles.hint}>从简历填入基本信息，AI 用来判断经验真实性</p>
        {[
          { label: '姓名 *', val: name, set: setName, placeholder: '如：王冬梅', type: 'text' },
          { label: '从业年限', val: yrs, set: setYrs, placeholder: '如：5', type: 'number' },
          { label: '带过宝宝数量', val: babies, set: setBabies, placeholder: '如：8', type: 'number' },
          { label: '最长一单（月）', val: longest, set: setLongest, placeholder: '如：3', type: 'number' },
        ].map(f => (
          <div key={f.label}>
            <label className={styles.fLabel}>{f.label}</label>
            <input className={styles.fInput} type={f.type} placeholder={f.placeholder} value={f.val}
              onChange={e => { f.set(e.target.value); setErr(''); }} />
          </div>
        ))}
        {err && <p className={styles.errText}>{err}</p>}
        <button className={styles.startBtn} style={{ marginTop: 20 }} onClick={beginInterview}>开始面试 →</button>
      </div>
    </div>
  );

  if (view === 'interview') return (
    <div className={styles.screen}>
      <div className={styles.progWrap}>
        <div className={styles.progBar} style={{ width: `${(answered / questions.length) * 100}%` }} />
      </div>
      <p className={styles.progText}>{answered}/{questions.length} 题已评估</p>

      <div className={styles.card}>
        <div className={styles.qHead}>
          <span className={styles.catBadge} style={{ background: CAT_COLOR[q.category] }}>{q.category}</span>
          <span className={styles.qNum}>{qIdx + 1}/{questions.length}</span>
        </div>
        {followUp && followUpText
          ? <><p className={styles.fuTag}>追问</p><p className={styles.qText}>{followUpText}</p></>
          : <p className={styles.qText}>{q.text}</p>}
        <button className={styles.guideBtn} onClick={() => setGuideOpen(o => !o)}>
          {guideOpen ? '▲ 收起参考答案' : '▼ 查看参考答案'}
        </button>
        {guideOpen && (
          <div className={styles.guideBox}>
            <p className={styles.guideText}>{q.answerGuide}</p>
            {q.redFlags.map((f, i) => <p key={i} className={styles.redFlag}>⚠️ {f}</p>)}
          </div>
        )}
      </div>

      <div className={styles.transcriptBox}>
        <div className={styles.txLabel}>
          <span className={styles.dot} style={{ background: phase === 'listening' ? '#E05454' : '#ddd' }} />
          {phase === 'listening' ? '正在听...' : '转录记录'}
        </div>
        <Waveform active={phase === 'listening'} />
        <p className={styles.txText}>{transcript || (phase === 'listening' ? '等待月嫂说话...' : '点击「开始听」后开始转录')}</p>
      </div>

      {/* 实时追问提示 */}
      {phase === 'listening' && autoFollowUp && (
        <div style={{
          margin: '0 16px',
          padding: '12px 16px',
          background: '#FFF8E6',
          borderRadius: 12,
          borderLeft: '3px solid #F59E0B',
          display: 'flex',
          alignItems: 'flex-start',
          gap: 8,
        }}>
          <span style={{ fontSize: 18 }}>💡</span>
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: 12, color: '#B45309', fontWeight: 700, marginBottom: 3 }}>AI 建议追问</p>
            <p style={{ fontSize: 15, color: '#1A1A2E', lineHeight: 1.5 }}>{autoFollowUp}</p>
          </div>
          <button onClick={clearAutoFollowUp}
            style={{ background: 'none', border: 'none', color: '#aaa', fontSize: 18, cursor: 'pointer', padding: 0, lineHeight: 1 }}>×</button>
        </div>
      )}

      {!followUp && phase !== 'result' && (
        <button
          className={`${styles.listenBtn} ${phase === 'listening' ? styles.active : ''}`}
          onClick={phase === 'listening' ? evalAnswer : handleListen}
          disabled={phase === 'processing'}
        >
          {phase === 'listening' ? '⏹ 停止 & 看AI分析' : phase === 'processing' ? 'AI 分析中...' : '🎙 开始听'}
        </button>
      )}

      {followUp && (
        <>
          <button
            className={`${styles.listenBtn} ${styles.fuBtn} ${phase === 'listening' ? styles.active : ''}`}
            onClick={phase === 'listening' ? handleFollowUpStop : handleListen}
          >
            {phase === 'listening' ? '⏹ 停止追问' : '🎙 开始听追问回答'}
          </button>
          <button className={styles.cancelBtn} onClick={() => { setFollowUp(false); setPhase('result'); }}>取消追问</button>
        </>
      )}

      {phase === 'processing' && <div className={styles.aiCard}><div className={styles.spinner} /> AI 分析中...</div>}
      {phase === 'result' && evalResult && !followUp && (
        <div className={styles.aiCard}>
          <div className={styles.scoreRow}>
            <span style={{ fontSize: 22 }}>{SCORE_EMOJI[evalResult.score]}</span>
            <span className={styles.scoreLabel}>{SCORE_LABEL[evalResult.score]}</span>
          </div>
          {evalResult.highlights.length > 0 && <div>
            <p className={styles.hlLabel}>✓ 答到了</p>
            {evalResult.highlights.map((h, i) => <p key={i} className={styles.hlItem}>• {h}</p>)}
          </div>}
          {evalResult.concerns.length > 0 && <div>
            <p className={styles.cnLabel}>✗ 未提到</p>
            {evalResult.concerns.map((c, i) => <p key={i} className={styles.cnItem}>• {c}</p>)}
          </div>}
          {evalResult.followUp && (
            <div className={styles.fuBox}>
              <p className={styles.fuLabel2}>AI 建议追问：</p>
              <p className={styles.fuText}>{evalResult.followUp}</p>
            </div>
          )}
          <div className={styles.aiActions}>
            {evalResult.followUp && <button className={styles.fuActionBtn} onClick={() => { setFollowUp(true); setFollowUpText(evalResult.followUp); setPhase('idle'); setTranscript(''); finalRef.current = ''; }}>追问</button>}
            <button className={styles.nextBtn} onClick={nextQ}>下一题 →</button>
          </div>
        </div>
      )}

      {err && <p className={styles.errText} style={{ padding: '0 16px' }}>{err}</p>}

      <div className={styles.bottomNav}>
        <button className={styles.navBtn} onClick={prevQ} disabled={qIdx === 0}>← 上题</button>
        <button className={styles.navBtn} style={{ color: '#aaa', border: '1px solid #eee' }} onClick={skip}>跳过</button>
        {qIdx === questions.length - 1
          ? <button className={styles.finBtn} onClick={finish}>生成报告</button>
          : <button className={styles.navBtn} onClick={nextQ}>下题 →</button>}
      </div>
    </div>
  );

  if (view === 'report') return (
    <div className={styles.screen}>
      <div className={styles.bar}><button className={styles.backBtn} onClick={goHome}>← 首页</button><span>面试报告</span></div>
      <div className={styles.reportScroll}>
        {loading && <div className={styles.loadWrap}><div className={styles.spinner} /><p>AI 生成报告中...</p></div>}
        {!loading && err && <p className={styles.errText} style={{ padding: 20 }}>{err}</p>}
        {!loading && report && session && (
          <div className={styles.reportWrap}>
            <div className={styles.card}>
              <h2 className={styles.rName}>{session.candidate.name}</h2>
              <p className={styles.rMeta}>{session.candidate.yearsOfExperience}年 · {session.candidate.babiesHandled}个宝宝 · 最长{session.candidate.longestAssignment}月</p>
              <div className={styles.recoBig} style={{ background: RECO_COLOR[report.recommendation] + '12', borderColor: RECO_COLOR[report.recommendation] }}>
                <span style={{ color: RECO_COLOR[report.recommendation], fontSize: 20, fontWeight: 800 }}>{report.recommendation}</span>
                <span className={styles.recoReason}>{report.recommendationReason}</span>
              </div>
              <p className={styles.authLine}>
                经验真实性：<span style={{ color: { high: '#2E9B6E', medium: '#D4880A', low: '#E05454' }[report.authenticityScore], fontWeight: 700 }}>
                  {{ high: '经验可信', medium: '经验存疑', low: '疑似注水' }[report.authenticityScore]}
                </span>
              </p>
              <p className={styles.authNote}>{report.authenticityNote}</p>
            </div>
            <div className={styles.card}>
              <p className={styles.cardTitle}>总评</p>
              <p className={styles.summaryText}>{report.summary}</p>
            </div>
            <div className={styles.card}>
              <p className={styles.cardTitle}>各维度评分</p>
              {CATS.map(cat => {
                const score = report.categoryScores[cat] || 0;
                const color = score >= 75 ? '#2E9B6E' : score >= 50 ? '#D4880A' : '#E05454';
                return (
                  <div key={cat} className={styles.barRow}>
                    <span className={styles.barLabel}>{cat.replace('儿童常见问题护理', '常见问题')}</span>
                    <div className={styles.barBg}><div className={styles.barFill} style={{ width: `${score}%`, background: color }} /></div>
                    <span style={{ color, fontWeight: 700, fontSize: 13, width: 28, textAlign: 'right' as const }}>{score}</span>
                  </div>
                );
              })}
            </div>
            <div className={styles.card}>
              <p className={styles.cardTitle}>维度分析</p>
              {CATS.map((cat, i) => (
                <div key={cat} style={{ padding: '12px 0', borderBottom: i < 3 ? '1px solid #F0F1FA' : 'none' }}>
                  <p style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>{i + 1}、{cat}</p>
                  <p style={{ fontSize: 14, color: '#555', lineHeight: 1.6 }}>{report.dimensionNotes[cat]}</p>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 12, margin: '0 16px' }}>
              <div style={{ flex: 1, background: '#F0FBF6', borderRadius: 14, padding: 14 }}>
                <p style={{ fontWeight: 700, color: '#2E9B6E', marginBottom: 8 }}>优势</p>
                {report.strengths.map((s, i) => <p key={i} style={{ fontSize: 13, color: '#2E7D5A', lineHeight: 1.8 }}>✓ {s}</p>)}
              </div>
              <div style={{ flex: 1, background: '#FFF0F0', borderRadius: 14, padding: 14 }}>
                <p style={{ fontWeight: 700, color: '#E05454', marginBottom: 8 }}>风险点</p>
                {report.concerns.map((c, i) => <p key={i} style={{ fontSize: 13, color: '#C04040', lineHeight: 1.8 }}>✗ {c}</p>)}
              </div>
            </div>

            {/* 每题转录详情 */}
            <div className={styles.card} style={{ marginTop: 14 }}>
              <p className={styles.cardTitle}>面试原话记录</p>
              {answers.filter(a => !a.skipped && a.transcript).map((a, i) => {
                const qs = questions.find(q => q.id === a.questionId);
                if (!qs) return null;
                const scoreColor = a.evaluation ? ['', '#E05454', '#D4880A', '#2E9B6E'][a.evaluation.score] : '#aaa';
                const scoreLabel = a.evaluation ? ['', '较差', '一般', '到位'][a.evaluation.score] : '';
                return (
                  <div key={a.questionId} style={{ paddingBottom: 16, marginBottom: 16, borderBottom: i < answers.filter(x => !x.skipped && x.transcript).length - 1 ? '1px solid #F0F1FA' : 'none' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                      <p style={{ fontSize: 13, fontWeight: 700, color: CAT_COLOR[qs.category], flex: 1 }}>{qs.category}</p>
                      {scoreLabel && <span style={{ fontSize: 12, color: scoreColor, fontWeight: 700, background: scoreColor + '18', borderRadius: 8, padding: '2px 8px', whiteSpace: 'nowrap' as const }}>{scoreLabel}</span>}
                    </div>
                    <p style={{ fontSize: 13, color: '#444', marginBottom: 8, lineHeight: 1.5 }}>Q：{qs.text}</p>
                    <p style={{ fontSize: 14, color: '#1A1A2E', lineHeight: 1.7, background: '#F9FAFB', borderRadius: 8, padding: '8px 12px' }}>
                      {a.transcript}
                    </p>
                    {a.followUpTranscripts.length > 0 && a.followUpTranscripts.map((ft, fi) => (
                      <p key={fi} style={{ fontSize: 13, color: '#666', lineHeight: 1.6, background: '#FFF8E6', borderRadius: 8, padding: '6px 12px', marginTop: 6 }}>
                        追问回答：{ft}
                      </p>
                    ))}
                  </div>
                );
              })}
            </div>
            <div style={{ height: 40 }} />
          </div>
        )}
      </div>
    </div>
  );

  return null;
}
