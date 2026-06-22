import { createClient } from '@supabase/supabase-js';
import type { InterviewSession } from '../types';

const SUPABASE_URL = 'https://vzseyxnfrnijgivcmdqr.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ6c2V5eG5mcm5pamdpdmNtZHFyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxMTQzNDcsImV4cCI6MjA5NzY5MDM0N30.iKMrAg9fdYAgJLUnxiI5J4KSXX3wzV_aFRn3LO6Elq0';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// 本地 userId 持久化
const USER_ID_KEY = 'yuesao_user_id';
export function getUserId(): string {
  let id = localStorage.getItem(USER_ID_KEY);
  if (!id) {
    id = 'user_' + Math.random().toString(36).slice(2, 10);
    localStorage.setItem(USER_ID_KEY, id);
  }
  return id;
}

export async function loadSessions(): Promise<InterviewSession[]> {
  const userId = getUserId();
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
  const userId = getUserId();
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
