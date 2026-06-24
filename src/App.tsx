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

  // 教程模式
  const [isTutorial, setIsTutorial] = useState(false);
  const [tutorialStep, setTutorialStep] = useState(0);
  const tutorialTypingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isTutorialRef = useRef(false);
  const tutorialStepRef = useRef(0);
  const TUTORIAL_DATA = [
    {
      qIdx: 0, hint: '系统正在模拟月嫂回答，看右侧追问建议如何出现',
      answer: '我做了快五年了，带过大概十七八个宝宝。最长的那家做了四个多月，月子里觉得好就把我留下来继续带，一直到宝宝快半岁才走。',
      followUpQ: '被续单的那家，宝宝有没有什么特别需要处理的情况？',
      followUpA: '那家是头胎宝宝，比较容易胀气，我每次喂完都会拍嗝，还教妈妈做排气操，大概两周就好多了。',
    },
    {
      qIdx: 4, hint: '这是一个好答案，注意追问建议怎么出现',
      answer: '不加水的，按照罐子上的比例冲就好。奶量根据宝宝月龄和体重调整，两个月每次80到100毫升，间隔约三小时。尿次够还一直找可以适当加；频繁吐奶就要考虑喂多了。',
      followUpQ: '如果宝宝体重增长偏慢，你会怎么判断是否需要加奶？',
      followUpA: '我会先看尿次数，少于六次、吃完表情不满足，这种情况下考虑加奶。体重要结合月龄正常范围来判断，不能只看绝对数字。',
    },
    {
      qIdx: 8, hint: '这个答案有问题，看 AI 给出了什么追问',
      answer: '我带的宝宝基本上都没有肠胀气，可能是我护理得比较好吧，喂奶姿势对的话宝宝就不会胀气。绞痛就是哭得比较厉害，一般哄哄就好了。',
      followUpQ: '如果宝宝睡觉时突然弓腰哭闹，你会怎么处理？',
      followUpA: '啊，那个哄一哄就好了，可能是做梦吓到了吧。',
    },
  ];
  const [redeemInput, setRedeemInput] = useState('');
  const [redeemMsg, setRedeemMsg] = useState('');
  const [redeemLoading, setRedeemLoading] = useState(false);

  const refreshSessions = () => {
    setSessionsLoading(true);
    dbLoad().then(data => { setSessions(data); setSessionsLoading(false); })
            .catch(() => setSessionsLoading(false));
    if (phone) getUserCredits(phone).then(c => setCredits(c.remaining)).catch(() => setCredits(0));
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
    // 教程：进入面试页自动开始第一题模拟
    if (view === 'interview' && isTutorialRef.current) {
      setTimeout(() => handleListen(), 800);
    }
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

  const startTutorial = () => {
    setSession(null); // 教程不创建真实 session，不计入次数、不存数据库
    resetInterview();
    isTutorialRef.current = true;
    tutorialStepRef.current = 0;
    setIsTutorial(true);
    setTutorialStep(0);
    setQIdx(TUTORIAL_DATA[0].qIdx);
    setView('interview');
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
    // 教程模式：用打字机模拟月嫂回答，不启动真实录音
    if (isTutorialRef.current) {
      setPhase('listening');
      const step = tutorialStepRef.current;
      const fullText = TUTORIAL_DATA[step]?.answer || '';
      let i = 0;
      if (tutorialTypingRef.current) clearInterval(tutorialTypingRef.current);
      tutorialTypingRef.current = setInterval(() => {
        i++;
        const current = fullText.slice(0, i);
        setTranscript(current);
        finalRef.current = current;
        if (i >= fullText.length) {
          clearInterval(tutorialTypingRef.current!);
          setPhase('idle');
          // 主答案打完：弹追问题目
          setTimeout(async () => {
            const tutData = TUTORIAL_DATA[step];
            setAutoFollowUp(tutData?.followUpQ || null);
            // 再等 2 秒，自动模拟月嫂回答追问
            setTimeout(() => {
              if (!isTutorialRef.current) return;
              const fuText = tutData?.followUpA || '';
              if (!fuText) return;
              setTranscript('');
              finalRef.current = '';
              setPhase('listening');
              let j = 0;
              tutorialTypingRef.current = setInterval(() => {
                j++;
                const cur = fuText.slice(0, j);
                setTranscript(cur);
                finalRef.current = cur;
                if (j >= fuText.length) {
                  clearInterval(tutorialTypingRef.current!);
                  setPhase('idle');
                  setAutoFollowUp(null); // 追问回答完，清除追问卡
                }
              }, 50);
            }, 2000);
          }, 300);
        }
      }, 50);
      return;
    }
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
    // 教程模式：按教程顺序切换
    if (isTutorial && direction === 1) {
      if (tutorialTypingRef.current) clearInterval(tutorialTypingRef.current);
      const nextTutStep = tutorialStep + 1;
      if (nextTutStep >= TUTORIAL_DATA.length) {
        // 教程完成 → 显示示例报告
        isTutorialRef.current = false;
        setIsTutorial(false);
        const sampleReport: InterviewReport = {
          authenticityScore: 'medium',
          authenticityNote: '从业5年带18个宝宝，但最长4个月略短，答题质量参差不齐，经验基本可信但有些知识点存在盲区。',
          categoryScores: { '工作经验核实': 72, '月嫂技能': 80, '儿童常见问题护理': 45, '先进育儿意识': 60 },
          strengths: ['有续单经历，说明服务质量较好', '奶粉喂养知识掌握扎实', '工作年限较长，基础护理熟练'],
          concerns: ['对肠胀气认知有明显错误，称带的宝宝从没有过肠胀气', '可能存在夸大自身护理能力的倾向'],
          recommendation: '谨慎考虑',
          recommendationReason: '基础技能可以，但儿科知识有明显漏洞',
          dimensionNotes: {
            '工作经验核实': '5年经验18个宝宝，有续单记录，整体可信，最长4个月略短。',
            '月嫂技能': '奶粉调配、喂养间隔说得清楚，有判断方法，是加分项。',
            '儿童常见问题护理': '肠胀气认知有误，称带的宝宝"从没有过肠胀气"，这是红旗——肠胀气是所有宝宝必经阶段，说明她要么不了解要么不诚实。',
            '先进育儿意识': '未测试，无法评估。',
          },
          summary: '王阿姨整体是中等水平的月嫂。基础护理技能掌握较好，特别是奶粉喂养方面说得有条理。但在儿童常见问题方面存在知识漏洞，关于肠胀气的回答暴露出对新生儿护理认知不够全面，需要在上户前特别沟通这块内容。建议录用前再追问几道护理类问题，重点考察她对黄疸、皮肤问题的处理经验。',
        };
        setReport(sampleReport);
        setSession({ id: 'tutorial_demo', candidate: { name: '示范·王阿姨', yearsOfExperience: 5, babiesHandled: 18, longestAssignment: 4 }, startedAt: new Date().toISOString(), answers: [], report: sampleReport });
        setView('report');
        return;
      }
      tutorialStepRef.current = nextTutStep;
      setTutorialStep(nextTutStep);
      setQIdx(TUTORIAL_DATA[nextTutStep].qIdx);
      setPhase('idle'); setTranscript(''); finalRef.current = '';
      setEvalResult(null); setFollowUp(false); setFollowUpText(null); setGuideOpen(false);
      clearAutoFollowUp();
      // 自动开始下一题的模拟（refs 已更新，不受状态异步影响）
      setTimeout(() => handleListen(), 800);
      return;
    }
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
        <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
          <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13 }}>{phone}</span>
          <button onClick={() => { clearPhone(); setPhone(''); setSessions([]); }}
            style={{ background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff', fontSize: 12, borderRadius: 20, padding: '4px 12px', cursor: 'pointer' }}>
            切换账号
          </button>
          <button onClick={startTutorial}
            style={{ background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff', fontSize: 12, borderRadius: 20, padding: '4px 12px', cursor: 'pointer' }}>
            🎓 教程
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
      {/* 教程提示横幅 */}
      {isTutorial && (
        <div style={{ background: '#6B7FD7', padding: '10px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: 11 }}>教程 {tutorialStep + 1}/3</span>
            <p style={{ color: '#fff', fontSize: 13, marginTop: 2 }}>{TUTORIAL_DATA[tutorialStep]?.hint}</p>
          </div>
          <button onClick={() => { isTutorialRef.current = false; setIsTutorial(false); setView('home'); }}
            style={{ background: 'none', border: '1px solid rgba(255,255,255,0.4)', color: '#fff', fontSize: 11, borderRadius: 12, padding: '4px 10px', cursor: 'pointer', whiteSpace: 'nowrap' as const }}>
            退出教程
          </button>
        </div>
      )}
      <div className={styles.progWrap}>
        <div className={styles.progBar} style={{ width: `${(answered / questions.length) * 100}%` }} />
      </div>
      <p className={styles.progText}>{answered}/{questions.length} 题已记录</p>

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

      {/* 一键开始录音（未录时显示，教程中隐藏） */}
      {phase === 'idle' && !isTutorial && (
        <button className={styles.listenBtn} onClick={handleListen}>
          🎙 开始听
        </button>
      )}

      {/* 录音中：只显示状态提示，无停止按钮 */}
      {phase === 'listening' && (
        <div style={{ textAlign: 'center', padding: '12px 0', color: '#E05454', fontSize: 14, fontWeight: 600 }}>
          🔴 录音中 — 月嫂说完后点「下一题」自动保存
        </div>
      )}

      {err && <p className={styles.errText} style={{ padding: '0 16px' }}>{err}</p>}

      <div className={styles.bottomNav}>
        <button className={styles.navBtn} onClick={prevQ} disabled={qIdx === 0}>← 上题</button>
        <button className={styles.navBtn} style={{ color: '#aaa', border: '1px solid #eee' }} onClick={skip}>跳过</button>
        {isTutorial
          ? <button className={styles.finBtn} onClick={nextQ}>{tutorialStep >= TUTORIAL_DATA.length - 1 ? '完成教程 ✓' : '下一示例 →'}</button>
          : qIdx === questions.length - 1
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
