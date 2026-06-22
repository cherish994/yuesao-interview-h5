import { createClient } from '@supabase/supabase-js';
import type { InterviewSession } from '../types';

const SUPABASE_URL = 'https://vzseyxnfrnijgivcmdqr.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ6c2V5eG5mcm5pamdpdmNtZHFyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxMTQzNDcsImV4cCI6MjA5NzY5MDM0N30.iKMrAg9fdYAgJLUnxiI5J4KSXX3wzV_aFRn3LO6Elq0';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function getUserId(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  if (data.user) return data.user.id;
  // 未登录时降级用本地 ID
  let id = localStorage.getItem('yuesao_user_id');
  if (!id) {
    id = 'anon_' + Math.random().toString(36).slice(2, 10);
    localStorage.setItem('yuesao_user_id', id);
  }
  return id;
}

export async function getCurrentUser() {
  const { data } = await supabase.auth.getUser();
  return data.user;
}

export async function logout() {
  await supabase.auth.signOut();
}

export async function loadSessions(): Promise<InterviewSession[]> {
  const userId = await getUserId();
  const { data, error } = await supabase
    .from('sessions')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('加载历史记录失败:', error.message);
    return [];
  }

  return (data || []).map(row => ({
    id: row.id,
    candidate: row.candidate,
    answers: row.answers || [],
    report: row.report,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  }));
}

export async function saveSession(session: InterviewSession): Promise<void> {
  const userId = await getUserId();
  const { error } = await supabase
    .from('sessions')
    .upsert({
      id: session.id,
      user_id: userId,
      candidate: session.candidate,
      answers: session.answers,
      report: session.report || null,
      started_at: session.startedAt,
      finished_at: session.finishedAt || null,
    });

  if (error) {
    console.error('保存记录失败:', error.message);
  }
}
