import { NextResponse } from 'next/server';
import { generateToxicWordPairs } from '@/ai/flows/generate-toxic-word-pairs-flow';

// Basic types for Telegram Bot API
interface User {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
}

interface Chat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
  title?: string;
}

interface Message {
  message_id: number;
  from?: User;
  chat: Chat;
  date: number;
  text?: string;
}

interface Update {
  update_id: number;
  message?: Message;
  // Other update types like callback_query can be added here
}

// Game-specific types
type Language = 'zh' | 'en';

type GameState = 'waiting' | 'words_distributed' | 'describing' | 'voting' | 'finished';

interface Player {
  id: number;
  username: string;
  isReady: boolean;
  role: 'civilian' | 'undercover' | 'undecided';
  word: string;
  description?: string;
  votedFor?: number;
}

interface Game {
  chatId: number;
  state: GameState;
  players: Map<number, Player>;
  words: {
    civilianWord: string;
    undercoverWord: string;
  };
  undercoverPlayerId?: number;
}


// In-memory store for game sessions. Replace with a database in production.
const games = new Map<number, Game>();
const MIN_PLAYERS = 3; 

// Per-chat language preference (persists across games in same chat)
const chatLanguages = new Map<number, Language>();

function getLanguageForChat(chatId: number, game?: Game): Language {
  if (game && 'language' in game && game.language) {
    return (game as Game & { language: Language }).language;
  }
  return chatLanguages.get(chatId) ?? 'zh';
}

/**
 * Sends a message to a given Telegram chat.
 * @param chatId The ID of the chat to send the message to.
 * @param text The message text.
 * @param extra Any extra parameters for the Telegram API.
 */
async function sendMessage(chatId: number, text: string, extra: any = {}) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error('TELEGRAM_BOT_TOKEN is not set');
    return;
  }
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown', ...extra }),
    });
    if (!response.ok) {
      const errorBody = await response.json();
      console.error('Telegram API error:', errorBody);
    }
  } catch (error) {
    console.error('Failed to send message:', error);
  }
}

/**
 * Starts a new game round, generating words and assigning roles.
 * @param game The game object.
 */
async function startGame(game: Game & { language?: Language }) {
  const lang = game.language ?? 'zh';
  await sendMessage(
    game.chatId,
    lang === 'zh'
      ? '所有玩家都已准备完毕，正在生成本局的卧底词和平民词，并随机分配身份……'
      : 'All players are ready! Generating the civilian and undercover words, and assigning roles...'
  );
  game.state = 'words_distributed';

  try {
    const wordPair = await generateToxicWordPairs({});
    game.words = wordPair;

    const players = Array.from(game.players.values());
    const undercoverIndex = Math.floor(Math.random() * players.length);
    const undercoverPlayer = players[undercoverIndex];
    game.undercoverPlayerId = undercoverPlayer.id;

    let dmFailed = false;
    for (const player of players) {
      if (player.id === undercoverPlayer.id) {
        player.role = 'undercover';
        player.word = game.words.undercoverWord;
      } else {
        player.role = 'civilian';
        player.word = game.words.civilianWord;
      }
      try {
        const dmTextZh = [
          `你所在的群（ID: ${game.chatId}）的一局「谁是卧底」已经开始！`,
          '',
          `你的词语是：*${player.word}*`,
          '',
          '请不要在群里说出你的词本身。',
          '下一步：想好一个简短描述，然后在这里私聊发送：',
          '/desc 你的描述内容（不要包含词本身）',
        ].join('\n');

        const dmTextEn = [
          `A new game of "Who is the Undercover" has started in group (ID: ${game.chatId}).`,
          '',
          `Your word is: *${player.word}*`,
          '',
          "Do NOT say your word directly in the group.",
          'Next: think of a short description, then DM me here:',
          '/desc your description (do NOT include the actual word)',
        ].join('\n');

        await sendMessage(player.id, lang === 'zh' ? dmTextZh : dmTextEn);
      } catch (dmError) {
        console.error(`Failed to DM player ${player.id}`, dmError);
        await sendMessage(
          game.chatId,
          `Could not send a private message to @${player.username}. Please make sure you have started a chat with the bot first! The game cannot start.`
        );
        dmFailed = true;
        break;
      }
    }

    if (dmFailed) {
      games.delete(game.chatId);
      await sendMessage(
        game.chatId,
        lang === 'zh'
          ? '有玩家无法收到机器人私聊发送的词，本局游戏已取消。\n请确保所有玩家都先主动私聊过机器人，然后再使用 /start 开局。'
          : 'Some players could not receive their word via DM, this game has been cancelled.\nPlease make sure everyone has started a private chat with the bot before using /start.'
      );
      return;
    }

    game.state = 'describing';
    const groupTextZh = [
      '🤫 本局的所有词语已经通过私聊发给各位玩家。',
      '',
      '【当前阶段：描述】',
      '每位玩家请在和机器人的私聊窗口中发送：',
      '/desc 你的描述内容（不要包含词本身，只能用特点来形容）',
      '',
      '所有人都描述完成后，机器人会在群里提示进入【投票阶段】，',
      '届时大家可以在群里使用 `/vote @用户名` 进行投票。',
    ].join('\n');

    const groupTextEn = [
      '🤫 All words have been sent to each player via private DM.',
      '',
      '[Current phase: Description]',
      'Each player, please DM the bot with:',
      '/desc your description (NO actual word, only hints)',
      '',
      'Once everyone has described, the bot will announce the [Voting Phase] in the group,',
      'then everyone can vote in the group using `/vote @username`.',
    ].join('\n');

    await sendMessage(game.chatId, lang === 'zh' ? groupTextZh : groupTextEn);
  } catch (error) {
    console.error('Failed to start game:', error);
    await sendMessage(
      game.chatId,
      lang === 'zh'
        ? '生成词语时出现问题，本局游戏已取消。请稍后再使用 /start 重新开局。'
        : 'Failed to generate words, this game has been cancelled. Please try /start again later.'
    );
    games.delete(game.chatId);
  }
}

function findGameForPlayer(userId: number): Game | undefined {
  for (const game of games.values()) {
    if (game.players.has(userId) && game.state !== 'finished') {
      return game;
    }
  }
  return undefined;
}

function computeVoteResult(game: Game) {
  const voteCounts = new Map<number, number>();
  for (const player of game.players.values()) {
    if (player.votedFor != null) {
      voteCounts.set(player.votedFor, (voteCounts.get(player.votedFor) ?? 0) + 1);
    }
  }

  let maxVotes = 0;
  let mostVotedPlayerId: number | undefined;
  for (const [targetId, count] of voteCounts.entries()) {
    if (count > maxVotes) {
      maxVotes = count;
      mostVotedPlayerId = targetId;
    } else if (count === maxVotes) {
      mostVotedPlayerId = undefined;
    }
  }

  return { mostVotedPlayerId, maxVotes };
}

/**
 * Handles incoming webhook requests from Telegram.
 * @param {Request} request - The incoming request object.
 * @returns {NextResponse} A response object.
 */
export async function POST(request: Request) {
  try {
    const body: Update = await request.json();
    console.log('Received Telegram update:', JSON.stringify(body, null, 2));

    if (body.message && body.message.text && body.message.from && body.message.chat.type !== 'private') {
      const chatId = body.message.chat.id;
      const text = body.message.text;
      const from = body.message.from;
      const userId = from.id;
      const username = from.username || from.first_name;

      const game = games.get(chatId);
      const lang = getLanguageForChat(chatId, game);

      // Command handling
      if (text.startsWith('/')) {
        const [command] = text.split(/ |@/);

        switch (command) {
          case '/lang': {
            const [, langArgRaw] = text.split(/\s+/, 2);
            const langArg = (langArgRaw ?? '').toLowerCase();

            let newLang: Language | undefined;
            if (langArg === 'zh' || langArg === 'cn') newLang = 'zh';
            if (langArg === 'en') newLang = 'en';

            if (!newLang) {
              await sendMessage(
                chatId,
                lang === 'zh'
                  ? '用法：/lang zh 或 /lang en\nUsage: /lang zh or /lang en'
                  : 'Usage: /lang zh or /lang en\n支持：zh（中文）、en（English）'
              );
              break;
            }

            chatLanguages.set(chatId, newLang);

            await sendMessage(
              chatId,
              newLang === 'zh'
                ? '本群的游戏语言已设置为：中文。'
                : 'The game language for this group has been set to English.'
            );
            break;
          }
          case '/start':
            if (game) {
              await sendMessage(
                chatId,
                '本群已经有一局游戏在进行中或等待中，请先结束当前游戏或在其他群开局。'
              );
            } else {
              const newGame: Game = {
                chatId,
                state: 'waiting',
                players: new Map(),
                words: { civilianWord: '', undercoverWord: '' },
              };
              (newGame as Game & { language?: Language }).language = getLanguageForChat(chatId);
              games.set(chatId, newGame);
              await sendMessage(
                chatId,
                lang === 'zh'
                  ? [
                      '🕵️ 新的一局「谁是卧底」已创建！',
                      '',
                      '【游戏规则简要说明】',
                      '- 每局有 1 名卧底，其他人为平民；',
                      '- 所有平民拿到同一个词，卧底拿到一个「很像但不一样」的词；',
                      '- 回合 1：所有玩家依次在群里用 /desc 进行描述，但不能说出词本身；',
                      '- 回合 2：大家根据描述，在私聊中用 /vote @用户名 投票，选出你怀疑的卧底；',
                      '- 若被票出的是卧底，则平民获胜；否则卧底获胜。',
                      '',
                      '【操作流程】',
                      '1. /join 加入游戏（至少 3 人）；',
                      '2. 所有已加入玩家在群里发送 /ready；',
                      '3. 机器人私聊发给大家各自的词；',
                      '4. 每人在群里用 /desc 发送自己的描述；',
                      '5. 所有人描述完后，在私聊里用 /vote @用户名 投票。',
                      '',
                      '如需切换语言，可使用：/lang zh 或 /lang en',
                    ].join('\n')
                  : [
                      '🕵️ A new game of "Who is the Undercover" has been created!',
                      '',
                      '[Quick rules]',
                      '- There is 1 undercover player, others are civilians;',
                      '- Civilians share the same word; the undercover has a similar but different word;',
                      '- Round 1: Each player uses /desc in the group to describe their word, without saying it directly;',
                      '- Round 2: Everyone privately DMs the bot /vote @username to vote for the suspected undercover;',
                      '- If the voted player is the undercover, civilians win; otherwise the undercover wins.',
                      '',
                      '[Game flow]',
                      '1. /join to join the game (at least 3 players);',
                      '2. All joined players send /ready in the group;',
                      '3. The bot DMs each player their word;',
                      '4. Each player uses /desc in the group to describe their word;',
                      '5. After all descriptions, everyone sends /vote @username in DM to vote.',
                      '',
                      'To change language, use: /lang zh or /lang en',
                    ].join('\n')
              );
            }
            break;

          case '/join':
            if (!game) {
              await sendMessage(
                chatId,
                lang === 'zh'
                  ? '当前没有进行中的游戏，可以使用 /start 开一局新游戏。'
                  : 'There is no active game. Use /start to create a new game.'
              );
            } else if (game.state !== 'waiting') {
              await sendMessage(
                chatId,
                lang === 'zh'
                  ? '本局游戏已经开始，请等待下一局再加入。'
                  : 'This game has already started. Please wait for the next round to join.'
              );
            } else if (game.players.has(userId)) {
              await sendMessage(
                chatId,
                lang === 'zh'
                  ? `@${username} 已经在本局游戏中。`
                  : `@${username} is already in this game.`
              );
            } else {
              const player: Player = {
                id: userId,
                username,
                isReady: false,
                role: 'undecided',
                word: '',
              };
              game.players.set(userId, player);
              await sendMessage(
                chatId,
                lang === 'zh'
                  ? [
                      `@${username} 加入了本局游戏！当前玩家数：${game.players.size} 人。`,
                      '',
                      '准备好后，请在群里发送：/ready',
                      '温馨提示：请所有玩家先和机器人私聊发一句话，确保能收到私聊消息。',
                    ].join('\n')
                  : [
                      `@${username} has joined the game! Current player count: ${game.players.size}.`,
                      '',
                      'When you are ready, send /ready in the group.',
                      'Tip: make sure every player has started a private chat with the bot so they can receive their word.',
                    ].join('\n')
              );
            }
            break;

          case '/ready':
            if (!game || !game.players.has(userId)) {
              await sendMessage(
                chatId,
                lang === 'zh'
                  ? '你还没有加入本局游戏，请先发送 /join。'
                  : 'You are not in this game. Please send /join first.'
              );
            } else if (game.state !== 'waiting') {
              await sendMessage(
                chatId,
                lang === 'zh'
                  ? '当前阶段不在等待准备中，无法标记 /ready。'
                  : 'The game is not in the waiting phase, you cannot /ready now.'
              );
            } else {
              const player = game.players.get(userId)!;
              if (player.isReady) {
                await sendMessage(
                  chatId,
                  lang === 'zh'
                    ? `@${username} 已经标记为准备好了。`
                    : `@${username} is already marked as ready.`
                );
              } else {
                player.isReady = true;
                const allPlayers = Array.from(game.players.values());
                const readyCount = allPlayers.filter(p => p.isReady).length;
                await sendMessage(
                  chatId,
                  lang === 'zh'
                    ? `@${username} 已准备！当前准备进度：${readyCount}/${allPlayers.length}。`
                    : `@${username} is ready! Ready status: ${readyCount}/${allPlayers.length}.`
                );

                const allReady = allPlayers.every(p => p.isReady);
                if (allPlayers.length >= MIN_PLAYERS && allReady) {
                  await startGame(game);
                } else if (allPlayers.length < MIN_PLAYERS && allReady) {
                  const diff = MIN_PLAYERS - allPlayers.length;
                  await sendMessage(
                    chatId,
                    lang === 'zh'
                      ? `所有已加入玩家都准备好了，但当前人数为 ${allPlayers.length} 人，至少需要 ${MIN_PLAYERS} 人才能开始，还差 ${diff} 人。`
                      : `All players are ready, but there are only ${allPlayers.length} players. You need at least ${MIN_PLAYERS}, so you are short of ${diff} players.`
                  );
                }
              }
            }
            break;
          
          case '/status':
            if (!game) {
              await sendMessage(
                chatId,
                lang === 'zh'
                  ? '当前没有进行中的游戏，可以使用 /start 开一局新游戏。'
                  : 'There is no active game. Use /start to create a new game.'
              );
            } else {
              const players = Array.from(game.players.values());
              if (lang === 'zh') {
                const playerList =
                  players
                    .map(p => `@${p.username}（${p.isReady ? '已准备' : '未准备'}）`)
                    .join('\n') || '暂时还没有玩家加入。';

                const stateMap: Record<GameState, string> = {
                  waiting: '等待玩家加入 / 准备',
                  words_distributed: '已分配词语，等待描述',
                  describing: '描述阶段（玩家私聊 /desc）',
                  voting: '投票阶段（群里 /vote）',
                  finished: '本局已结束',
                };

                await sendMessage(
                  chatId,
                  [
                    `当前游戏状态：${stateMap[game.state]}`,
                    '',
                    `玩家列表（共 ${players.length} 人）：`,
                    playerList,
                  ].join('\n')
                );
              } else {
                const playerList =
                  players
                    .map(p => `@${p.username} (${p.isReady ? 'Ready' : 'Not ready'})`)
                    .join('\n') || 'No players have joined yet.';

                const stateMapEn: Record<GameState, string> = {
                  waiting: 'Waiting for players / ready',
                  words_distributed: 'Words assigned, waiting for descriptions',
                  describing: 'Description phase (players DM /desc)',
                  voting: 'Voting phase (group /vote)',
                  finished: 'Game finished',
                };

                await sendMessage(
                  chatId,
                  [
                    `Current game state: ${stateMapEn[game.state]}`,
                    '',
                    `Players (${players.length}):`,
                    playerList,
                  ].join('\n')
                );
              }
            }
            break;
          
          case '/cancel':
            if (game) {
              games.delete(chatId);
              await sendMessage(
                chatId,
                lang === 'zh'
                  ? '本局游戏已被取消。你可以使用 /start 开启新的一局。'
                  : 'This game has been cancelled. You can start a new one with /start.'
              );
            } else {
              await sendMessage(
                chatId,
                lang === 'zh'
                  ? '当前没有可以取消的游戏。'
                  : 'There is no game to cancel.'
              );
            }
            break;

          case '/desc': {
            if (!game) {
              await sendMessage(
                chatId,
                lang === 'zh'
                  ? '当前没有进行中的游戏，可以使用 /start 开一局新游戏。'
                  : 'There is no active game. Use /start to create a new game.'
              );
              break;
            }
            if (
              game.state !== 'words_distributed' &&
              game.state !== 'describing'
            ) {
              await sendMessage(
                chatId,
                lang === 'zh'
                  ? '现在还不是描述阶段，请等待机器人提示进入描述阶段后，再使用 /desc 描述。'
                  : 'It is not the description phase yet. Please wait for the bot to announce the description phase before using /desc.'
              );
              break;
            }
            if (!game.players.has(userId)) {
              await sendMessage(
                chatId,
                lang === 'zh'
                  ? '只有本局游戏中的玩家才能进行描述。'
                  : 'Only players in this game can send descriptions.'
              );
              break;
            }

            const [, ...rest] = text.split(' ');
            const description = rest.join(' ').trim();
            if (!description) {
              await sendMessage(
                chatId,
                lang === 'zh'
                  ? '请在 /desc 后面输入描述内容。\n例如：/desc 小时候在农村经常见到。'
                  : 'Please provide a description after /desc.\nExample: /desc Something you often see in the countryside.'
              );
              break;
            }

            const player = game.players.get(userId)!;
            player.description = description;

            await sendMessage(
              chatId,
              lang === 'zh'
                ? `@${username} 已在群里给出了描述。`
                : `@${username} has given their description in the group.`
            );

            const allPlayers = Array.from(game.players.values());
            const describedCount = allPlayers.filter(
              (p) => p.description && p.description.trim().length > 0
            ).length;

            await sendMessage(
              chatId,
              lang === 'zh'
                ? `当前描述进度：${describedCount}/${allPlayers.length}。`
                : `Current description progress: ${describedCount}/${allPlayers.length}.`
            );

            const allDescribed = allPlayers.every(
              (p) => p.description && p.description.trim().length > 0
            );
            if (allDescribed) {
              game.state = 'voting';
              for (const p of allPlayers) {
                p.votedFor = undefined;
              }

              const playerList = allPlayers
                .map((p) => `@${p.username}`)
                .join(', ');

              await sendMessage(
                chatId,
                lang === 'zh'
                  ? [
                      '所有玩家都已经在群里完成了描述！',
                      `玩家：${playerList}`,
                      '',
                      '【当前阶段：投票】',
                      '请每位玩家打开与机器人的私聊窗口，发送：',
                      '/vote @用户名',
                      '来为你怀疑的玩家投票。',
                    ].join('\n')
                  : [
                      'All players have finished their descriptions in the group!',
                      `Players: ${playerList}`,
                      '',
                      '[Current phase: Voting]',
                      'Each player, please open your private chat with the bot and send:',
                      '/vote @username',
                      'to vote for the player you suspect.',
                    ].join('\n')
              );
            }
            break;
          }
            
          default:
            // Could add a help message here for unknown commands
            break;
        }
      }
    } else if (body.message?.chat.type === 'private' && body.message.from) {
      const chatId = body.message.chat.id;
      const text = body.message.text ?? '';
      const from = body.message.from;
      const userId = from.id;
      const username = from.username || from.first_name;

      if (text.startsWith('/vote')) {
        const [, targetRaw] = text.split(/\s+/, 2);
        const game = findGameForPlayer(userId);
        const lang = game ? getLanguageForChat(game.chatId, game) : 'zh';

        if (!targetRaw) {
          await sendMessage(
            chatId,
            lang === 'zh'
              ? '用法：/vote @用户名\n例如：/vote @player1'
              : 'Usage: /vote @username\nExample: /vote @player1'
          );
          return NextResponse.json({ status: 'ok' });
        }

        if (!game) {
          await sendMessage(
            chatId,
            lang === 'zh'
              ? '你当前没有参与任何进行中的游戏。请先在群里加入一局游戏。'
              : 'You are not currently in an active game. Join a game in a group chat first.'
          );
        } else if (game.state !== 'voting') {
          await sendMessage(
            chatId,
            lang === 'zh'
              ? '当前还不是投票阶段，请等待机器人在群里提示进入投票阶段后再使用 /vote。'
              : 'It is not the voting phase yet. Please wait for the bot to announce the voting phase in the group before using /vote.'
          );
        } else {
          const targetUsername = targetRaw.replace('@', '');
          const targetPlayer = Array.from(game.players.values()).find(
            (p) => p.username === targetUsername
          );

          if (!targetPlayer) {
            await sendMessage(
              chatId,
              lang === 'zh'
                ? `本局游戏中没有找到用户名为 @${targetUsername} 的玩家，请检查是否输入正确。`
                : `Could not find a player with username @${targetUsername} in this game. Please check the name.`
            );
          } else {
            const voter = game.players.get(userId);
            if (!voter) {
              await sendMessage(
                chatId,
                lang === 'zh'
                  ? '你不在本局游戏的玩家列表中。'
                  : 'You are not part of the player list for this game.'
              );
            } else if (voter.votedFor != null) {
              await sendMessage(
                chatId,
                lang === 'zh'
                  ? '你已经投过票，不能重复投票。'
                  : 'You have already voted and cannot vote again.'
              );
            } else {
              voter.votedFor = targetPlayer.id;
              await sendMessage(
                chatId,
                lang === 'zh'
                  ? `你已在私聊中投票给 @${targetPlayer.username}。`
                  : `You have voted for @${targetPlayer.username} in DM.`
              );

              const allPlayers = Array.from(game.players.values());
              const votesCast = allPlayers.filter(
                (p) => p.votedFor != null
              ).length;

              await sendMessage(
                game.chatId,
                lang === 'zh'
                  ? `当前投票进度：${votesCast}/${allPlayers.length}。`
                  : `Current voting progress: ${votesCast}/${allPlayers.length}.`
              );

              const allVoted = allPlayers.every(
                (p) => p.votedFor != null
              );
              if (allVoted) {
                const { mostVotedPlayerId, maxVotes } = computeVoteResult(game);

                if (!mostVotedPlayerId || maxVotes === 0) {
                  await sendMessage(
                    game.chatId,
                    lang === 'zh'
                      ? '本轮投票出现平票或没有有效投票，本局不淘汰任何人（为了简单起见，本简化版游戏到此结束）。'
                      : 'This voting round ended in a tie or with no valid votes. No one is eliminated and, for simplicity, this game ends here.'
                  );
                } else {
                  const eliminated = game.players.get(mostVotedPlayerId);
                  const undercoverId = game.undercoverPlayerId;

                  if (eliminated && undercoverId && eliminated.id === undercoverId) {
                    await sendMessage(
                      game.chatId,
                      lang === 'zh'
                        ? `大家以 ${maxVotes} 票投出了 @${eliminated.username}。\n🎉 恭喜平民阵营获胜，卧底已经被揪出来了！`
                        : `The group has voted out @${eliminated.username} with ${maxVotes} votes.\n🎉 Civilians win! The undercover has been caught.`
                    );
                  } else if (eliminated) {
                    await sendMessage(
                      game.chatId,
                      lang === 'zh'
                        ? `大家以 ${maxVotes} 票投出了 @${eliminated.username}。\n🕵️ 卧底成功骗过了大家，卧底阵营获胜！`
                        : `The group has voted out @${eliminated.username} with ${maxVotes} votes.\n🕵️ The undercover survives and wins this simplified game!`
                    );
                  }
                }

                const revealLines = Array.from(game.players.values()).map(
                  (p) => {
                    const role =
                      p.role === 'undercover'
                        ? 'Undercover'
                        : p.role === 'civilian'
                        ? 'Civilian'
                        : 'Undecided';
                    return `@${p.username}: ${role} - word: *${p.word}*`;
                  }
                );

                await sendMessage(
                  game.chatId,
                  lang === 'zh'
                    ? ['本局游戏结束！', '', revealLines.join('\n')].join('\n')
                    : ['Game over!', '', revealLines.join('\n')].join('\n')
                );

                game.state = 'finished';
                games.delete(game.chatId);
              }
            }
          }
        }
      } else if (text.startsWith('/start') || text.startsWith('/join') || text.startsWith('/lang') || text.startsWith('/desc')) {
        await sendMessage(
          chatId,
          'These commands should be used in a group chat where the game is running.\n这些指令需要在有机器人的群聊里使用。'
        );
      } else {
        await sendMessage(
          chatId,
          'I have received your message.\nIf you are in a game, send your word description using:\n/desc your description here'
        );
      }
    }

    // Acknowledge the update to Telegram.
    return NextResponse.json({ status: 'ok' });
  } catch (error) {
    console.error('Error processing webhook:', error);
    // Avoid sending detailed errors back to Telegram for security.
    return NextResponse.json({ status: 'error', message: 'Internal Server Error' }, { status: 500 });
  }
}
