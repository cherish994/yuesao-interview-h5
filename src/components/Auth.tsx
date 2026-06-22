import React, { useState } from 'react';
import { supabase } from '../services/supabaseService';

interface Props {
  onLogin: () => void;
}

type Step = 'phone' | 'otp';

export default function Auth({ onLogin }: Props) {
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const formatPhone = (p: string) => {
    const digits = p.replace(/\D/g, '');
    return digits.startsWith('86') ? `+${digits}` : `+86${digits}`;
  };

  const sendOTP = async () => {
    if (!phone.trim()) { setErr('请输入手机号'); return; }
    setLoading(true); setErr('');
    const { error } = await supabase.auth.signInWithOtp({
      phone: formatPhone(phone),
    });
    setLoading(false);
    if (error) { setErr(error.message); return; }
    setStep('otp');
  };

  const verifyOTP = async () => {
    if (!otp.trim()) { setErr('请输入验证码'); return; }
    setLoading(true); setErr('');
    const { error } = await supabase.auth.verifyOtp({
      phone: formatPhone(phone),
      token: otp,
      type: 'sms',
    });
    setLoading(false);
    if (error) { setErr('验证码错误，请重试'); return; }
    onLogin();
  };

  return (
    <div style={styles.wrap}>
      <div style={styles.card}>
        <div style={styles.logo}>🤱</div>
        <h1 style={styles.title}>月嫂面试助手</h1>
        <p style={styles.sub}>登录后面试记录永久保存，换手机也能查看</p>

        {step === 'phone' ? (
          <>
            <div style={styles.inputWrap}>
              <span style={styles.prefix}>+86</span>
              <input
                style={styles.input}
                type="tel"
                placeholder="请输入手机号"
                value={phone}
                onChange={e => { setPhone(e.target.value); setErr(''); }}
                maxLength={11}
              />
            </div>
            {err && <p style={styles.err}>{err}</p>}
            <button style={styles.btn} onClick={sendOTP} disabled={loading}>
              {loading ? '发送中...' : '获取验证码'}
            </button>
          </>
        ) : (
          <>
            <p style={styles.hint}>验证码已发送到 +86 {phone}</p>
            <input
              style={{ ...styles.input, width: '100%', boxSizing: 'border-box' as const, textAlign: 'center' as const, letterSpacing: 12, fontSize: 24 }}
              type="number"
              placeholder="请输入 6 位验证码"
              value={otp}
              onChange={e => { setOtp(e.target.value); setErr(''); }}
              maxLength={6}
            />
            {err && <p style={styles.err}>{err}</p>}
            <button style={styles.btn} onClick={verifyOTP} disabled={loading}>
              {loading ? '验证中...' : '登录'}
            </button>
            <button style={styles.link} onClick={() => { setStep('phone'); setOtp(''); setErr(''); }}>
              重新发送验证码
            </button>
          </>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrap: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#F5F6FF',
    padding: 24,
  },
  card: {
    background: '#fff',
    borderRadius: 24,
    padding: '40px 32px',
    width: '100%',
    maxWidth: 380,
    textAlign: 'center',
    boxShadow: '0 4px 24px rgba(107,127,215,0.12)',
  },
  logo: { fontSize: 48, marginBottom: 12 },
  title: { fontSize: 22, fontWeight: 800, color: '#1A1A2E', marginBottom: 8 },
  sub: { fontSize: 14, color: '#888', lineHeight: 1.6, marginBottom: 32 },
  inputWrap: {
    display: 'flex',
    alignItems: 'center',
    border: '1.5px solid #E0E1EE',
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 12,
  },
  prefix: {
    padding: '14px 12px',
    background: '#F7F8FF',
    color: '#555',
    fontSize: 15,
    borderRight: '1.5px solid #E0E1EE',
  },
  input: {
    flex: 1,
    padding: '14px 16px',
    border: 'none',
    outline: 'none',
    fontSize: 16,
    color: '#1A1A2E',
  },
  btn: {
    width: '100%',
    padding: '16px 0',
    background: '#6B7FD7',
    color: '#fff',
    border: 'none',
    borderRadius: 12,
    fontSize: 16,
    fontWeight: 700,
    cursor: 'pointer',
    marginTop: 8,
  },
  hint: { fontSize: 14, color: '#888', marginBottom: 16 },
  err: { color: '#E05454', fontSize: 13, marginBottom: 8 },
  link: {
    background: 'none',
    border: 'none',
    color: '#6B7FD7',
    fontSize: 14,
    cursor: 'pointer',
    marginTop: 12,
    textDecoration: 'underline',
  },
};
