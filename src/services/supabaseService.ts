import { createClient } from '@supabase/supabase-js';
import type { InterviewSession } from '../types';

const SUPABASE_URL = 'https://vzseyxnfrnijgivcmdqr.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ6c2V5eG5mcm5pamdpdmNtZHFyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxMTQzNDcsImV4cCI6MjA5NzY5MDM0N30.iKMrAg9fdYAgJLUnxiI5J4KSXX3wzV_aFRn3LO6Elq0';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const PHONE_KEY = 'yuesao_phone';
const DEVICE_KEY = 'yuesao_device_id';

export function getStoredPhone(): string {
  return localStorage.getItem(PHONE_KEY) || '';
}

export function storePhone(phone: string) {
  localStorage.setItem(PHONE_KEY, phone);
}

export function clearPhone() {
  localStorage.removeItem(PHONE_KEY);
}

// 生成/获取设备 ID（首次访问生成，永久存本地）
export function getDeviceId(): string {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    // 结合浏览器特征生成稳定指纹
    const raw = [
      navigator.userAgent,
      navigator.language,
      screen.width + 'x' + screen.height,
      new Date().getTimezoneOffset(),
      navigator.hardwareConcurrency || 0,
    ].join('|');
    // 简单哈希
    let hash = 0;
    for (let i = 0; i < raw.length; i++) {
      hash = (Math.imul(31, hash) + raw.charCodeAt(i)) | 0;
    }
    id = 'dev_' + Math.abs(hash).toString(36) + '_' + Math.random().toString(36).slice(2, 8);
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

// 检查设备的免费次数（跨手机号）
export async function getDeviceFreeUsed(): Promise<number> {
  const deviceId = getDeviceId();
  const { count } = await supabase
    .from('sessions')
    .select('*', { count: 'exact', head: true })
    .eq('device_id', deviceId);
  return count || 0;
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
// 免费次数：绑定设备（防刷号），付费次数：绑定手机号
export async function getUserCredits(phone: string): Promise<{ remaining: number; used: number }> {
  const FREE = 2;
  const deviceId = getDeviceId();

  // 该设备用了几次（跨所有手机号）
  const { count: deviceUsed } = await supabase
    .from('sessions')
    .select('*', { count: 'exact', head: true })
    .eq('device_id', deviceId);

  // 该手机号用了几次（总计）
  const { count: phoneUsed } = await supabase
    .from('sessions')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', phone);

  // 付费次数（按手机号）
  const { data: codes } = await supabase
    .from('invite_codes')
    .select('credits')
    .eq('redeemed_by', phone);

  const paid = (codes || []).reduce((sum, c) => sum + (c.credits || 0), 0);

  // 设备免费剩余：min(设备还没用完的, 手机号账户下还剩的)
  const deviceFreeLeft = Math.max(0, FREE - (deviceUsed || 0));
  const freeRemaining = Math.min(deviceFreeLeft, Math.max(0, FREE - (phoneUsed || 0)));

  // 付费剩余 = 付费总量 - 手机号已用超出免费的部分
  const paidUsed = Math.max(0, (phoneUsed || 0) - FREE);
  const paidRemaining = Math.max(0, paid - paidUsed);

  return {
    remaining: freeRemaining + paidRemaining,
    used: phoneUsed || 0,
  };
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
      device_id: getDeviceId(),   // 记录设备指纹，防刷号
      candidate: session.candidate,
      answers: session.answers,
      report: session.report || null,
      started_at: session.startedAt,
      finished_at: session.finishedAt || null,
    });

  if (error) console.error('保存失败:', error.message);
}
