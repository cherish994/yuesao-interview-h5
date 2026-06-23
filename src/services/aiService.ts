import { AIEvaluation, AnswerRecord, CandidateProfile, InterviewReport, Question } from '../types';
import { questions } from '../data/questionBank';

const API_BASE = 'https://api.deepseek.com/chat/completions';
const MODEL = 'deepseek-chat';
const API_KEY = import.meta.env.VITE_DEEPSEEK_API_KEY as string;

async function callLLM(system: string, user: string, maxTokens = 1024): Promise<string> {
  const res = await fetch(API_BASE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`AI 请求失败: ${res.status}`);
  const data = await res.json();
  return data.choices[0].message.content;
}

function parseJSON(text: string): any {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('AI 返回格式异常');
  return JSON.parse(match[0]);
}

export async function evaluateAnswer(
  question: Question,
  transcript: string,
  candidate: CandidateProfile,
): Promise<AIEvaluation> {
  const system = `你是专业的月嫂面试评估助手。候选人：${candidate.name}，从业${candidate.yearsOfExperience}年，带过${candidate.babiesHandled}个宝宝。只输出JSON，不要其他文字。`;
  const user = `题目：${question.text}
评判要点：${question.answerGuide}
正面信号：${question.greenFlags.join('、')}
警示信号：${question.redFlags.join('、')}
月嫂回答：${transcript || '（未作答）'}

请以JSON返回：{"score":1|2|3,"highlights":["要点1","要点2"],"concerns":["问题1"],"followUp":"追问或null"}
评分：1=差/有明显错误，2=一般，3=到位`;

  const raw = await callLLM(system, user, 512);
  const p = parseJSON(raw);
  return {
    score: p.score as 1 | 2 | 3,
    highlights: p.highlights || [],
    concerns: p.concerns || [],
    followUp: p.followUp || null,
  };
}

// 实时追问：录音过程中分析是否需要追问
export async function getRealtimeFollowUp(
  questionText: string,
  transcript: string,
): Promise<string | null> {
  if (transcript.length < 10) return null;
  const system = `你是月嫂面试助手，帮助面试官在对话中及时追问。只输出JSON，不要其他文字。`;
  const user = `当前题目：${questionText}
月嫂回答（可能不完整）：${transcript}

判断：回答是否含糊、不具体、或者有需要深挖的地方？
- 如果有，给出一个具体的追问（20字以内，直接问月嫂的话，口语化）
- 如果回答已清晰完整，返回 null

只输出：{"followUp": "追问内容" | null}`;
  try {
    const raw = await callLLM(system, user, 80);
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const p = JSON.parse(match[0]);
    return p.followUp || null;
  } catch {
    return null;
  }
}

export async function generateReport(
  candidate: CandidateProfile,
  answers: AnswerRecord[],
): Promise<InterviewReport> {
  const answered = answers.filter(a => !a.skipped && a.transcript).length;
  const scored = answers.filter(a => a.evaluation);
  const avgScore = scored.length ? scored.reduce((s, a) => s + (a.evaluation?.score || 0), 0) / scored.length : 0;

  const summary = answers.map(a => {
    const q = questions.find(q => q.id === a.questionId);
    if (!q) return '';
    const sc = a.evaluation ? `评分${a.evaluation.score}/3` : a.skipped ? '跳过' : '未评估';
    return `【${q.category}】${q.text}\n回答：${a.transcript || '未作答'} ${sc}\n亮点：${a.evaluation?.highlights.join('；') || '无'} 问题：${a.evaluation?.concerns.join('；') || '无'}`;
  }).filter(Boolean).join('\n\n');

  const system = `你是专业月嫂评估顾问，用口语化中文写评估报告。只输出JSON。`;
  const user = `候选人：${candidate.name}，${candidate.yearsOfExperience}年经验，带过${candidate.babiesHandled}个宝宝，最长${candidate.longestAssignment}个月。
作答${answered}/${answers.length}题，平均分${avgScore.toFixed(1)}/3。

${summary}

请输出：{
  "authenticityScore":"high"|"medium"|"low",
  "authenticityNote":"经验真实性50字以内",
  "categoryScores":{"工作经验核实":0-100,"月嫂技能":0-100,"儿童常见问题护理":0-100,"先进育儿意识":0-100},
  "strengths":["优势1","优势2"],
  "concerns":["风险1","风险2"],
  "recommendation":"强烈推荐"|"推荐"|"谨慎考虑"|"不推荐",
  "recommendationReason":"一句话30字以内",
  "dimensionNotes":{"工作经验核实":"分析","月嫂技能":"分析","儿童常见问题护理":"分析","先进育儿意识":"分析"},
  "summary":"综合评价150字左右"
}`;

  const raw = await callLLM(system, user, 2048);
  return parseJSON(raw) as InterviewReport;
}
