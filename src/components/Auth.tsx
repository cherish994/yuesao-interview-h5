import React, { useState } from 'react';

interface Props {
  onLogin: (phone: string) => void;
}

export default function Auth({ onLogin }: Props) {
  const [phone, setPhone] = useState('');
  const [err, setErr] = useState('');

  const handleEnter = () => {
    const digits = phone.replace(/\D/g, '');
    if (digits.length !== 11) { setErr('请输入 11 位手机号'); return; }
    onLogin(digits);
  };

  return (
    <div style={styles.wrap}>
      <div style={styles.card}>
        <div style={styles.logo}>🤱</div>
        <h1 style={styles.title}>月嫂面试助手</h1>
        <p style={styles.sub}>输入手机号，面试记录永久保存{'\n'}换设备输同一个号码即可找回</p>
        <input
          style={styles.input}
          type="tel"
          placeholder="请输入手机号"
          value={phone}
          onChange={e => { setPhone(e.target.value); setErr(''); }}
          onKeyDown={e => e.key === 'Enter' && handleEnter()}
          maxLength={11}
          autoFocus
        />
        {err && <p style={styles.err}>{err}</p>}
        <button style={styles.btn} onClick={handleEnter}>进入</button>
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
    maxWidth: 360,
    textAlign: 'center',
    boxShadow: '0 4px 24px rgba(107,127,215,0.12)',
  },
  logo: { fontSize: 52, marginBottom: 12 },
  title: { fontSize: 22, fontWeight: 800, color: '#1A1A2E', marginBottom: 8 },
  sub: { fontSize: 14, color: '#888', lineHeight: 1.8, marginBottom: 32, whiteSpace: 'pre-line' },
  input: {
    display: 'block',
    width: '100%',
    padding: '14px 16px',
    border: '1.5px solid #E0E1EE',
    borderRadius: 12,
    fontSize: 18,
    color: '#1A1A2E',
    textAlign: 'center',
    letterSpacing: 4,
    outline: 'none',
    boxSizing: 'border-box',
    marginBottom: 8,
  },
  btn: {
    display: 'block',
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
  err: { color: '#E05454', fontSize: 13, marginBottom: 8 },
};
