import { createClient } from '@supabase/supabase-js';
import type { InterviewSession } from '../types';

const SUPABASE_URL = 'https://vzseyxnfrnijgivcmdqr.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ6c2V5eG5mcm5pamdpdmNtZHFyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxMTQzNDcsImV4cCI6MjA5NzY5MDM0N30.iKMrAg9fdYAgJLUnxiI5J4KSXX3wzV_aFRn3LO6Elq0';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const PHONE_KEY = 'yuesao_phone';

export function getStoredPhone(): string {
  return localStorage.getItem(PHONE_KEY) || '';
}

export function storePhone(phone: string) {
  localStorage.setItem(PHONE_KEY, phone);
}

export function clearPhone() {
  localStorage.removeItem(PHONE_KEY);
}

export async function loadSessions(): Promise<InterviewSession[]> {
  const phone = getStoredPhone();
  if (!phone) return [];

  const { data, error } = await supabase
    .from('sessions')
    .select('*')
    .eq('user_id', phone)
    .order('created_at', { ascending: false });

  if (error) { console.error('加载失败:', error.message); return []; }

  return (data || []).map(row => ({
    id: row.id,
    candidate: row.candidate,
    answers: row.answers || [],
    report: row.report,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  }));
}

// 查询用户剩余次数
// 免费 2 次 + 兑换码累计次数 - 已用次数
export async function getUserCredits(phone: string): Promise<{ remaining: number; used: number; freeLeft: number }> {
  const FREE = 2;

  // 已用次数
  const { count: used } = await supabase
    .from('sessions')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', phone);

  // 已兑换的付费次数
  const { data: codes } = await supabase
    .from('invite_codes')
    .select('credits')
    .eq('redeemed_by', phone);

  const paid = (codes || []).reduce((sum, c) => sum + (c.credits || 0), 0);
  const total = FREE + paid;
  const usedCount = used || 0;
  const freeLeft = Math.max(0, FREE - usedCount);
  const remaining = Math.max(0, total - usedCount);

  return { remaining, used: usedCount, freeLeft };
}

// 兑换码
export async function redeemCode(phone: string, code: string): Promise<{ ok: boolean; credits?: number; error?: string }> {
  const { data, error } = await supabase
    .from('invite_codes')
    .select('*')
    .eq('code', code.trim().toUpperCase())
    .single();

  if (error || !data) return { ok: false, error: '兑换码不存在' };
  if (data.redeemed_by) return { ok: false, error: '该兑换码已被使用' };

  const { error: updateErr } = await supabase
    .from('invite_codes')
    .update({ redeemed_by: phone, redeemed_at: new Date().toISOString() })
    .eq('code', code.trim().toUpperCase());

  if (updateErr) return { ok: false, error: '兑换失败，请重试' };
  return { ok: true, credits: data.credits };
}

export async function deleteSession(id: string): Promise<void> {
  const { error } = await supabase.from('sessions').delete().eq('id', id);
  if (error) console.error('删除失败:', error.message);
}

export async function saveSession(session: InterviewSession): Promise<void> {
  const phone = getStoredPhone();
  if (!phone) return;

  const { error } = await supabase
    .from('sessions')
    .upsert({
      id: session.id,
      user_id: phone,
      candidate: session.candidate,
      answers: session.answers,
      report: session.report || null,
      started_at: session.startedAt,
      finished_at: session.finishedAt || null,
    });

  if (error) console.error('保存失败:', error.message);
}
