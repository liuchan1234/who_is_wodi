import { NextResponse } from 'next/server';
import Database from 'better-sqlite3';

// --- Basic Telegram types (simplified) ---

interface TgUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
}

interface TgChat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
}

interface TgMessage {
  message_id: number;
  from?: TgUser;
  chat: TgChat;
  date: number;
  text?: string;
}

interface TgCallbackQuery {
  id: string;
  from: TgUser;
  message?: TgMessage;
  data?: string;
}

interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  callback_query?: TgCallbackQuery;
}

export const runtime = 'nodejs';

// --- CP quiz types/state ---

type CpQuestionId = 1 | 2 | 3 | 4 | 5 | 6;
type CpAnswerOptionId = 1 | 2 | 3 | 4;

interface CpSession {
  userId: number;
  username: string;
  currentQuestion: CpQuestionId;
  answers: Partial<Record<CpQuestionId, CpAnswerOptionId>>;
  finished: boolean;
  lastUpdated: number;
}

interface CpProfile {
  userId: number;
  username: string;
  answers: Record<CpQuestionId, CpAnswerOptionId>;
  createdAt: number;
}

// --- Lightweight SQLite storage (file-based) ---

// 单个进程内创建一个全局的 DB 实例与预编译语句。
// DB 文件会放在项目根目录下：who_is_wodi/cp_bot.db
const db = new Database('cp_bot.db');

db.pragma('journal_mode = WAL');

db.prepare(
  `
  CREATE TABLE IF NOT EXISTS cp_sessions (
    user_id INTEGER PRIMARY KEY,
    username TEXT NOT NULL,
    current_question INTEGER NOT NULL,
    answers_json TEXT NOT NULL,
    finished INTEGER NOT NULL DEFAULT 0,
    last_updated INTEGER NOT NULL
  )
`
).run();

db.prepare(
  `
  CREATE TABLE IF NOT EXISTS cp_profiles (
    user_id INTEGER PRIMARY KEY,
    username TEXT NOT NULL,
    answers_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )
`
).run();

const upsertSessionStmt = db.prepare(`
  INSERT INTO cp_sessions (user_id, username, current_question, answers_json, finished, last_updated)
  VALUES (@user_id, @username, @current_question, @answers_json, @finished, @last_updated)
  ON CONFLICT(user_id) DO UPDATE SET
    username = excluded.username,
    current_question = excluded.current_question,
    answers_json = excluded.answers_json,
    finished = excluded.finished,
    last_updated = excluded.last_updated
`);

const getSessionStmt = db.prepare(`
  SELECT user_id, username, current_question, answers_json, finished, last_updated
  FROM cp_sessions
  WHERE user_id = ?
`);

const upsertProfileStmt = db.prepare(`
  INSERT INTO cp_profiles (user_id, username, answers_json, created_at)
  VALUES (@user_id, @username, @answers_json, @created_at)
  ON CONFLICT(user_id) DO UPDATE SET
    username = excluded.username,
    answers_json = excluded.answers_json,
    created_at = excluded.created_at
`);

// SQLite helpers

function saveSession(session: CpSession) {
  const answersJson = JSON.stringify(session.answers);
  upsertSessionStmt.run({
    user_id: session.userId,
    username: session.username,
    current_question: session.currentQuestion,
    answers_json: answersJson,
    finished: session.finished ? 1 : 0,
    last_updated: session.lastUpdated,
  });
}

function loadSession(userId: number): CpSession | null {
  const row = getSessionStmt.get(userId) as
    | {
        user_id: number;
        username: string;
        current_question: number;
        answers_json: string;
        finished: number;
        last_updated: number;
      }
    | undefined;

  if (!row) {
    return null;
  }

  let parsedAnswers: Partial<Record<CpQuestionId, CpAnswerOptionId>> = {};
  try {
    const obj = JSON.parse(row.answers_json) as Partial<
      Record<string, CpAnswerOptionId>
    >;
    const result: Partial<Record<CpQuestionId, CpAnswerOptionId>> = {};
    (Object.keys(obj) as string[]).forEach((k) => {
      const qidNum = Number(k) as CpQuestionId;
      const val = obj[k];
      if (val === 1 || val === 2 || val === 3 || val === 4) {
        result[qidNum] = val;
      }
    });
    parsedAnswers = result;
  } catch {
    parsedAnswers = {};
  }

  return {
    userId: row.user_id,
    username: row.username,
    currentQuestion: (row.current_question as CpQuestionId) ?? 1,
    answers: parsedAnswers,
    finished: !!row.finished,
    lastUpdated: row.last_updated,
  };
}

function saveProfile(profile: CpProfile) {
  upsertProfileStmt.run({
    user_id: profile.userId,
    username: profile.username,
    answers_json: JSON.stringify(profile.answers),
    created_at: profile.createdAt,
  });
}

// --- Question config ---

interface CpQuestionConfig {
  id: CpQuestionId;
  text: string;
  options: { id: CpAnswerOptionId; label: string }[];
}

const QUESTIONS: CpQuestionConfig[] = [
  {
    id: 1,
    text: [
      '🇨🇳 你的赛博真身与猎物雷达是？',
      '🇬🇧 Your cyber identity & target?',
      '🇷🇺 Твой кибер-статус и цель кого ищешь?',
    ].join('\n'),
    options: [
      { id: 1, label: '🐺 直男找妹子 / Straight Guy / Гетеро парень' },
      { id: 2, label: '💃 直女找帅哥 / Straight Girl / Гетеро девушка' },
      { id: 3, label: '🌈 男女通吃颜控 / Bi & Pan / Би и Пан (Мне всё равно)' },
      { id: 4, label: '🍿 纯吃瓜不恋爱 / Just here for drama / Я тут только ради драмы' },
    ],
  },
  {
    id: 2,
    text: [
      '🇨🇳 你的真实心理年龄属于？',
      "🇬🇧 What's your true mental age?",
      '🇷🇺 Твой реальный ментальный возраст?',
    ].join('\n'),
    options: [
      {
        id: 1,
        label: '🌪️ 00后：整顿职场 / Gen Z: Chaotic / Зумер: Полный хаос',
      },
      {
        id: 2,
        label: '☕ 90后：养生朋克 / Millennial: Tired / Миллениал: Вечно уставший',
      },
      {
        id: 3,
        label: '🛑 80后：莫挨老子 / Gen X: Leave me alone / Бумер: Не трогай меня',
      },
      {
        id: 4,
        label: '🍼 小学生：清澈愚蠢 / Baby: Pure & Dumb / Ребенок: Чист и глуп',
      },
    ],
  },
  {
    id: 3,
    text: [
      '🇨🇳 你的星座属性是？',
      '🇬🇧 Your Zodiac element?',
      '🇷🇺 Твоя стихия Зодиака?',
    ].join('\n'),
    options: [
      {
        id: 1,
        label:
          '🔥 火象：暴脾气 (白羊/狮子/射手) / Fire (Aries/Leo/Sag) / 🔥 Огонь (Вспыльчивый)',
      },
      {
        id: 2,
        label:
          '🌍 土象：搞钱第一 (金牛/处女/摩羯) / Earth (Tau/Vir/Cap) / 🌍 Земля (Только деньги)',
      },
      {
        id: 3,
        label:
          '💨 风象：精神分裂 (双子/天秤/水瓶) / Air (Gem/Lib/Aqu) / 💨 Воздух (С шизой)',
      },
      {
        id: 4,
        label:
          '💧 水象：恋爱脑 (巨蟹/天蝎/双鱼) / Water (Can/Sco/Pis) / 💧 Вода (Раб любви)',
      },
    ],
  },
  {
    id: 4,
    text: [
      '🇨🇳 你目前的社交精神状态？',
      '🇬🇧 Your current social energy?',
      '🇷🇺 Твое социальное состояние сейчас?',
    ].join('\n'),
    options: [
      { id: 1, label: '🦋 E人：社牛狂魔 / Extrovert / Экстраверт: Душа компании' },
      { id: 2, label: '🦇 I人：阴暗爬行 / Introvert / Интроверт: Сижу в тени' },
      { id: 3, label: '🧊 T人：冷血杀手 / Thinker / Мыслитель: Холодный разум' },
      { id: 4, label: '😭 F人：眼泪机器 / Feeler / Чувствующий: Вечно в слезах' },
    ],
  },
  {
    id: 5,
    text: [
      '🇨🇳 感情里你最大的缺点 (Red Flag)？',
      '🇬🇧 Your biggest Red Flag? 🚩',
      '🇷🇺 Твой главный Red Flag (Недостаток)? 🚩',
    ].join('\n'),
    options: [
      { id: 1, label: '😍 骨灰级颜控 / Total Simp for looks / Люблю только красивых' },
      { id: 2, label: '🥶 忽冷忽热 / Hot & Cold player / То жарко, то холодно' },
      { id: 3, label: '📱 查岗控制狂 / Control Freak / Маньяк контроля' },
      { id: 4, label: '👻 秒下头跑路 / Ghosting Pro / Мастер гостинга (исчезаю)' },
    ],
  },
  {
    id: 6,
    text: [
      '🇨🇳 匹配成功后，奔现第一件事干嘛？',
      '🇬🇧 First thing on your blind date?',
      '🇷🇺 Первое дело на свидании вслепую?',
    ].join('\n'),
    options: [
      { id: 1, label: '🥂 去酒吧灌醉对方 / Get wasted at a bar / Напоить друг друга в баре' },
      { id: 2, label: '🎬 假装文艺看电影 / Boring movie date / Скучный фильм в кино' },
      { id: 3, label: '🛏️ 懂的都懂直奔主题 / Skip to the bedroom / Сразу к делу в спальню' },
      {
        id: 4,
        label:
          '🏃‍♂️ 借口上厕所死遁 / Fake an emergency & run / Сбежать через туалет',
      },
    ],
  },
];

function getQuestionConfig(id: CpQuestionId): CpQuestionConfig {
  const q = QUESTIONS.find((question) => question.id === id);
  if (!q) {
    throw new Error(`Question ${id} not found`);
  }
  return q;
}

// --- Telegram helpers (CP bot token) ---

async function sendCpMessage(chatId: number, text: string, extra: any = {}) {
  const token = process.env.TELEGRAM_CP_BOT_TOKEN;
  if (!token) {
    console.error('TELEGRAM_CP_BOT_TOKEN is not set');
    return;
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'Markdown',
        ...extra,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error('Failed to send CP message', res.status, body);
    }
  } catch (err) {
    console.error('Error sending CP message', err);
  }
}

async function answerCallbackQuery(callbackQueryId: string) {
  const token = process.env.TELEGRAM_CP_BOT_TOKEN;
  if (!token) {
    return;
  }

  try {
    await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: callbackQueryId }),
    });
  } catch (err) {
    console.error('Failed to answer callback query', err);
  }
}

async function sendQuestion(userId: number, questionId: CpQuestionId) {
  const q = getQuestionConfig(questionId);

  await sendCpMessage(userId, q.text, {
    reply_markup: {
      inline_keyboard: [
        q.options.map((o) => ({
          text: o.label,
          callback_data: `q${q.id}:${o.id}`, // e.g. "q1:3"
        })),
      ],
    },
  });
}

// --- Report generation ---

function buildHumanReport(
  answers: Record<CpQuestionId, CpAnswerOptionId>,
  username: string
): string {
  const genderMap: Record<CpAnswerOptionId, string> = {
    1: '直男，雷达只对长发飘飘有信号',
    2: '直女，专盯人间清俊帅哥',
    3: '颜控双箭头，只尊重高颜值碳基生物',
    4: '纯吃瓜旁观者，本人不下场只点评',
  };

  const ageMap: Record<CpAnswerOptionId, string> = {
    1: '00 后整顿职场，嘴上说躺平，手里简历递得比谁都快',
    2: '90 后养生朋克，保温杯里泡枸杞，一边 emo 一边还在打工',
    3: '80 后防御塔，心里只有「别来烦我」五个字',
    4: '精神小学生，清澈又愚蠢，对一切修罗场充满好奇',
  };

  const redFlagMap: Record<CpAnswerOptionId, string> = {
    1: '骨灰级颜控：长得好看就都是对的，三观可以后补',
    2: '忽冷忽热：聊天秒回三天，消失也能三天三夜',
    3: '查岗控制狂：在意对方到连外卖骑手都要吃醋',
    4: '秒下头跑路：一旦对方说错一句话，你就立刻人间蒸发',
  };

  const actionMap: Record<CpAnswerOptionId, string> = {
    1: '第一回合就拉去喝酒，心里想着「要么假装醉，要么把对方灌醉」。',
    2: '强行安排文艺电影，结果全程在黑暗里刷手机看梗图。',
    3: '刚见面十分钟就试探「要不要去你家坐坐？」',
    4: '一边说「我去下个洗手间」，一边已经在拼车界面点了回家的车。',
  };

  const a1 = genderMap[answers[1]];
  const a2 = ageMap[answers[2]];
  const a5 = redFlagMap[answers[5]];
  const a6 = actionMap[answers[6]];

  const lines = [
    `👤 *${username} 的赛博 CP 测试档案*`,
    '',
    `你是一个 ${a1}，心理年龄走向：${a2}。`,
    `感情里的最大 Red Flag：${a5}。`,
    '',
    '如果你和群友成功匹配，第一场奔现约会大概率是这样展开的：',
    a6,
    '',
    '—— 这份问卷结果会被用来和群友做「谁和谁才是真 CP」匹配，记得拉大家都来做一份。',
  ];

  return lines.join('\n');
}

// --- Webhook handler ---

export async function POST(request: Request) {
  try {
    const update = (await request.json()) as TgUpdate;
    console.log('CP bot update:', JSON.stringify(update, null, 2));

    // 1) 普通消息：主要处理 /cpstart
    if (update.message?.from && update.message.text) {
      const msg = update.message!;
      const from = msg.from!;
      const rawText = msg.text ?? '';
      const text = rawText.trim();
      const userId = from.id;
      const username = from.username || from.first_name;

      if (msg.chat.type === 'private' && text.startsWith('/cpstart')) {
        const session: CpSession = {
          userId,
          username,
          currentQuestion: 1,
          answers: {},
          finished: false,
          lastUpdated: Date.now(),
        };

        saveSession(session);

        await sendCpMessage(
          userId,
          [
            '🚀 6 题赛博 CP 测试开始！',
            '',
            '接下来我会给你连发 6 道选择题，每题只有 4 个按钮，',
            '全程只需要点按钮，不用打字，很快就能测出你的恋爱灾难体质。',
          ].join('\n')
        );

        await sendQuestion(userId, 1);

        return NextResponse.json({ status: 'ok' });
      }

      if (
        msg.chat.type === 'private' &&
        (text.startsWith('/cphelp') || text.startsWith('/start'))
      ) {
        await sendCpMessage(
          userId,
          [
            '这是一个专门用来测试「你和群友谁才是真 CP」的 bot 👀',
            '',
            '在这里私聊我发送：',
            '/cpstart',
            '就可以开始 6 题测试。',
          ].join('\n')
        );

        return NextResponse.json({ status: 'ok' });
      }
    }

    // 2) 处理按钮点击（callback_query）
    if (update.callback_query && update.callback_query.from) {
      const cq = update.callback_query;
      const from = cq.from;
      const userId = from.id;
      const data = cq.data ?? '';

      const match = data.match(/^q(\d):(\d)$/);
      if (!match) {
        if (cq.id) {
          await answerCallbackQuery(cq.id);
        }
        return NextResponse.json({ status: 'ok' });
      }

      const qid = Number(match[1]) as CpQuestionId;
      const oid = Number(match[2]) as CpAnswerOptionId;

      const session = loadSession(userId);

      if (!session || session.finished) {
        if (cq.id) {
          await answerCallbackQuery(cq.id);
        }
        await sendCpMessage(
          userId,
          '当前没有进行中的测试，可以发送 /cpstart 重新做一份。'
        );
        return NextResponse.json({ status: 'ok' });
      }

      if (qid !== session.currentQuestion) {
        if (cq.id) {
          await answerCallbackQuery(cq.id);
        }
        await sendCpMessage(
          userId,
          '这道题已经记好了，请直接看我刚发给你的最新一题按钮～'
        );
        return NextResponse.json({ status: 'ok' });
      }

      session.answers[qid] = oid;
      session.lastUpdated = Date.now();
      saveSession(session);

      if (qid < 6) {
        const nextQ = (qid + 1) as CpQuestionId;
        session.currentQuestion = nextQ;

        if (cq.id) {
          await answerCallbackQuery(cq.id);
        }

        await sendQuestion(userId, nextQ);
      } else {
        session.finished = true;

        const fullAnswers: Record<CpQuestionId, CpAnswerOptionId> = {
          1: session.answers[1] ?? 1,
          2: session.answers[2] ?? 1,
          3: session.answers[3] ?? 1,
          4: session.answers[4] ?? 1,
          5: session.answers[5] ?? 1,
          6: session.answers[6] ?? 1,
        };

        saveProfile({
          userId,
          username: session.username,
          answers: fullAnswers,
          createdAt: Date.now(),
        });

        if (cq.id) {
          await answerCallbackQuery(cq.id);
        }

        const report = buildHumanReport(fullAnswers, session.username);
        await sendCpMessage(userId, report);
      }

      return NextResponse.json({ status: 'ok' });
    }

    return NextResponse.json({ status: 'ok' });
  } catch (error) {
    console.error('Error in CP webhook:', error);
    return NextResponse.json(
      { status: 'error', message: 'Internal Server Error' },
      { status: 500 }
    );
  }
}

