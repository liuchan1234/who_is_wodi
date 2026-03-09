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
type CpLanguage = 'en' | 'zh' | 'ru';

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

db.prepare(
  `
  CREATE TABLE IF NOT EXISTS cp_user_lang (
    user_id INTEGER PRIMARY KEY,
    language TEXT NOT NULL
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

const getUserLangStmt = db.prepare(`
  SELECT language
  FROM cp_user_lang
  WHERE user_id = ?
`);

const upsertUserLangStmt = db.prepare(`
  INSERT INTO cp_user_lang (user_id, language)
  VALUES (@user_id, @language)
  ON CONFLICT(user_id) DO UPDATE SET
    language = excluded.language
`);

const deleteSessionStmt = db.prepare(`
  DELETE FROM cp_sessions
  WHERE user_id = ?
`);

const deleteProfileStmt = db.prepare(`
  DELETE FROM cp_profiles
  WHERE user_id = ?
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

function resetUserCpData(userId: number) {
  deleteSessionStmt.run(userId);
  deleteProfileStmt.run(userId);
}

function getUserLanguage(userId: number): CpLanguage {
  try {
    const row = getUserLangStmt.get(userId) as { language: string } | undefined;
    if (!row) return 'en';
    if (row.language === 'zh' || row.language === 'ru' || row.language === 'en') {
      return row.language;
    }
    return 'en';
  } catch {
    return 'en';
  }
}

function setUserLanguage(userId: number, lang: CpLanguage) {
  upsertUserLangStmt.run({ user_id: userId, language: lang });
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
  text: Record<CpLanguage, string>;
  options: { id: CpAnswerOptionId; label: Record<CpLanguage, string> }[];
}

const QUESTIONS: CpQuestionConfig[] = [
  {
    id: 1,
    text: {
      zh: '🇨🇳 你的赛博真身与猎物雷达是？',
      en: '🇬🇧 Your cyber identity & target?',
      ru: '🇷🇺 Твой кибер-статус и цель кого ищешь?',
    },
    options: [
      {
        id: 1,
        label: {
          zh: '🐺 直男找妹子',
          en: '🐺 Straight Guy (seeking girls)',
          ru: '🐺 Гетеро парень (ищу девушку)',
        },
      },
      {
        id: 2,
        label: {
          zh: '💃 直女找帅哥',
          en: '💃 Straight Girl (seeking guys)',
          ru: '💃 Гетеро девушка (ищу парня)',
        },
      },
      {
        id: 3,
        label: {
          zh: '🌈 男女通吃颜控',
          en: '🌈 Bi / Pan, face-obsessed',
          ru: '🌈 Би / Пан, главное — внешность',
        },
      },
      {
        id: 4,
        label: {
          zh: '🍿 纯吃瓜不恋爱',
          en: '🍿 Just here for drama',
          ru: '🍿 Только ради драмы',
        },
      },
    ],
  },
  {
    id: 2,
    text: {
      zh: '🇨🇳 你的真实心理年龄属于？',
      en: "🇬🇧 What's your true mental age?",
      ru: '🇷🇺 Твой реальный ментальный возраст?',
    },
    options: [
      {
        id: 1,
        label: {
          zh: '🌪️ 00后：整顿职场',
          en: '🌪️ Gen Z: chaotic reformers',
          ru: '🌪️ Зумер: полный хаос',
        },
      },
      {
        id: 2,
        label: {
          zh: '☕ 90后：养生朋克',
          en: '☕ Millennial: tired but surviving',
          ru: '☕ Миллениал: вечно уставший',
        },
      },
      {
        id: 3,
        label: {
          zh: '🛑 80后：莫挨老子',
          en: "🛑 Gen X: don't bother me",
          ru: '🛑 Бумер: не трогай меня',
        },
      },
      {
        id: 4,
        label: {
          zh: '🍼 小学生：清澈愚蠢',
          en: '🍼 Kid: pure and silly',
          ru: '🍼 Ребёнок: чистый и глупый',
        },
      },
    ],
  },
  {
    id: 3,
    text: {
      zh: '🇨🇳 你的星座属性是？',
      en: '🇬🇧 Your Zodiac element?',
      ru: '🇷🇺 Твоя стихия Зодиака?',
    },
    options: [
      {
        id: 1,
        label: {
          zh: '🔥 火象：暴脾气 (白羊/狮子/射手)',
          en: '🔥 Fire: hot-headed (Aries / Leo / Sag)',
          ru: '🔥 Огонь: вспыльчивый (Овен / Лев / Стрелец)',
        },
      },
      {
        id: 2,
        label: {
          zh: '🌍 土象：搞钱第一 (金牛/处女/摩羯)',
          en: '🌍 Earth: money first (Taurus / Virgo / Capricorn)',
          ru: '🌍 Земля: главное деньги (Телец / Дева / Козерог)',
        },
      },
      {
        id: 3,
        label: {
          zh: '💨 风象：精神分裂 (双子/天秤/水瓶)',
          en: '💨 Air: chaotic mind (Gemini / Libra / Aquarius)',
          ru: '💨 Воздух: шиза (Близнецы / Весы / Водолей)',
        },
      },
      {
        id: 4,
        label: {
          zh: '💧 水象：恋爱脑 (巨蟹/天蝎/双鱼)',
          en: '💧 Water: love-brained (Cancer / Scorpio / Pisces)',
          ru: '💧 Вода: раб любви (Рак / Скорпион / Рыбы)',
        },
      },
    ],
  },
  {
    id: 4,
    text: {
      zh: '🇨🇳 你目前的社交精神状态？',
      en: '🇬🇧 Your current social energy?',
      ru: '🇷🇺 Твоё текущее социальное состояние?',
    },
    options: [
      {
        id: 1,
        label: {
          zh: '🦋 E人：社牛狂魔（外向）',
          en: '🦋 Extrovert: social butterfly',
          ru: '🦋 Экстраверт: душа компании',
        },
      },
      {
        id: 2,
        label: {
          zh: '🦇 I人：阴暗爬行（内向）',
          en: '🦇 Introvert: hiding in the dark',
          ru: '🦇 Интроверт: сижу в тени',
        },
      },
      {
        id: 3,
        label: {
          zh: '🧊 T人：冷血杀手（理性）',
          en: '🧊 Thinker: cold logic',
          ru: '🧊 Мыслитель: холодный разум',
        },
      },
      {
        id: 4,
        label: {
          zh: '😭 F人：眼泪机器（感性）',
          en: '😭 Feeler: emotional fountain',
          ru: '😭 Чувствующий: вечные слёзы',
        },
      },
    ],
  },
  {
    id: 5,
    text: {
      zh: '🇨🇳 感情里你最大的缺点 (Red Flag)？',
      en: '🇬🇧 Your biggest Red Flag in relationships? 🚩',
      ru: '🇷🇺 Твой главный Red Flag в отношениях? 🚩',
    },
    options: [
      {
        id: 1,
        label: {
          zh: '😍 骨灰级颜控',
          en: '😍 Extreme looks-only simp',
          ru: '😍 Люблю только красивых',
        },
      },
      {
        id: 2,
        label: {
          zh: '🥶 忽冷忽热',
          en: '🥶 Hot & cold behaviour',
          ru: '🥶 То жарко, то холодно',
        },
      },
      {
        id: 3,
        label: {
          zh: '📱 查岗控制狂',
          en: '📱 Control freak (checks everything)',
          ru: '📱 Маньяк контроля',
        },
      },
      {
        id: 4,
        label: {
          zh: '👻 秒下头跑路',
          en: '👻 Ghosting pro (disappears fast)',
          ru: '👻 Мастер гостинга (исчезаю)',
        },
      },
    ],
  },
  {
    id: 6,
    text: {
      zh: '🇨🇳 匹配成功后，奔现第一件事干嘛？',
      en: '🇬🇧 First thing you do on a successful blind date?',
      ru: '🇷🇺 Что ты сделаешь первым делом на удачном свидании вслепую?',
    },
    options: [
      {
        id: 1,
        label: {
          zh: '🥂 去酒吧灌醉对方',
          en: '🥂 Go to a bar and get (both) drunk',
          ru: '🥂 В бар — напоить друг друга',
        },
      },
      {
        id: 2,
        label: {
          zh: '🎬 假装文艺看电影',
          en: '🎬 Pretend to be artsy and watch a movie',
          ru: '🎬 Притвориться интеллигентом и пойти в кино',
        },
      },
      {
        id: 3,
        label: {
          zh: '🛏️ 懂的都懂直奔主题',
          en: '🛏️ Go straight to the bedroom (you know)',
          ru: '🛏️ Сразу к делу, в спальню',
        },
      },
      {
        id: 4,
        label: {
          zh: '🏃‍♂️ 借口上厕所死遁',
          en: '🏃‍♂️ Fake an emergency and run away',
          ru: '🏃‍♂️ Сбежать под предлогом туалета',
        },
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
  const lang = getUserLanguage(userId);

  await sendCpMessage(userId, q.text[lang] ?? q.text.en, {
    reply_markup: {
      inline_keyboard: q.options.map((o) => [
        {
          text: o.label[lang] ?? o.label.en,
          callback_data: `q${q.id}:${o.id}`, // e.g. "q1:3"
        },
      ]),
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

      if (msg.chat.type === 'private' && text.startsWith('/cplang')) {
        const parts = text.split(/\s+/);
        const langCode = (parts[1] || '').toLowerCase();

        let lang: CpLanguage | null = null;
        if (langCode === 'en') lang = 'en';
        if (langCode === 'zh' || langCode === 'cn' || langCode === 'zh-cn') lang = 'zh';
        if (langCode === 'ru' || langCode === 'ru-ru') lang = 'ru';

        if (!lang) {
          await sendCpMessage(
            userId,
            [
              'Usage: /cplang en | zh | ru',
              '',
              'Examples:',
              '/cplang en  - English (default)',
              '/cplang zh  - 中文',
              '/cplang ru  - Русский',
            ].join('\n')
          );
          return NextResponse.json({ status: 'ok' });
        }

        setUserLanguage(userId, lang);

        const confirmText =
          lang === 'en'
            ? '✅ Language set to English. Send /cpstart to begin the quiz.'
            : lang === 'zh'
            ? '✅ 已切换为中文文案。发送 /cpstart 开始 6 题测试。'
            : '✅ Язык переключён на русский. Отправь /cpstart, чтобы начать тест.';

        await sendCpMessage(userId, confirmText);
        return NextResponse.json({ status: 'ok' });
      }

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

      if (msg.chat.type === 'private' && text.startsWith('/cprestart')) {
        resetUserCpData(userId);

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
            '🔁 你的 CP 测试已重置，现在重新开始 6 题测验！',
            '',
            '接下来我会重新给你连发 6 道选择题，每题只有 4 个按钮，',
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

      if (qid < 6) {
        const nextQ = (qid + 1) as CpQuestionId;
        session.currentQuestion = nextQ;

        // 保存更新后的当前题目进度
        saveSession(session);

        if (cq.id) {
          await answerCallbackQuery(cq.id);
        }

        await sendQuestion(userId, nextQ);
      } else {
        session.finished = true;

        // 保存完成状态与最终答案
        saveSession(session);

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

