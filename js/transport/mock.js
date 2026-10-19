// 模擬傳訊層（階段一）。和之後的 supabase.js 長得一模一樣（約定見 emitter.js），
// 所以畫面層分不出差別。
//
// 它會做三件事：
// 1. 假的使用者不定時進來、說話、離開。
// 2. 同一個瀏覽器的不同分頁用 BroadcastChannel 真的互相傳訊息。
// 3. 用網址參數模擬連線問題：?test=fail（第一次連不上）、?test=disconnect（進入 15 秒後斷線 10 秒）。

import { createEmitter } from './emitter.js';
import { createId } from '../chat.js';

const TAB_CHANNEL = 'ranunculus-hall:mock';
const HEARTBEAT_MS = 4000;     // 每 4 秒跟其他分頁說「我還在」
const TAB_TIMEOUT_MS = 12000;  // 超過 12 秒沒消息，就當作那個分頁離開了（像真的斷線偵測會晚一點）
const HELLO_WAIT_MS = 300;     // 剛進來時，等其他分頁回報自己

const BOT_NAMES = ['薇拉', '夜雨', '舊信封', '老唱盤', '蕾絲手套', '午夜圓舞曲', '毛茛', '雪後', '灰鴿子', '第三支舞'];

const BOT_LINES = [
  '窗外的雪終於停了。',
  '晚安，各位。',
  '這裡好安靜，像散場後的舞廳。',
  '有人記得最後一支舞是什麼嗎？',
  '我帶了一張沒有封套的唱片，\n不知道是誰的。',
  '燭火快燒完了。',
  '那年冬天的暖氣壞了三次。',
  '今天的天空是褪色照片的顏色。',
  '樂隊只剩一把小提琴了，\n但還是很好聽。',
  '誰把蕾絲手套忘在衣帽間？',
  '春天好像真的要來了。',
  '我在角落，不太會跳舞。',
  '慢一點的華爾滋比較適合今晚。',
  '鋼琴有一個鍵一直走音。',
  '我找到那張老唱片的資料：https://example.com/archive/records/ballroom-waltz-side-b-remastered',
];

// 整個網頁共用（每次進入都會建立新的傳訊層，所以不能放在裡面）：
// ?test=fail 只讓第一次連線失敗，?test=disconnect 只斷線一次
let failTested = false;
let disconnectTested = false;

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

export function createMockTransport({ bots = true, test = null } = {}) {
  const events = createEmitter();
  const peers = new Map(); // userId → { entry, kind: 'bot' | 'tab', lastSeen }
  let me = null;
  let online = false;
  let channel = null;
  let timers = new Set();
  let botsSeeded = false;

  function later(fn, ms) {
    const id = setTimeout(() => {
      timers.delete(id);
      fn();
    }, ms);
    timers.add(id);
    return id;
  }

  function every(fn, ms) {
    const id = setInterval(fn, ms);
    timers.add(id);
    return id;
  }

  function clearTimers() {
    for (const id of timers) {
      clearTimeout(id);
      clearInterval(id);
    }
    timers = new Set();
  }

  function presenceList() {
    const list = [...peers.values()].map((p) => p.entry);
    if (me) list.push(me);
    return list;
  }

  function emitPresence() {
    events.emit('presence', presenceList());
  }

  function addPeer(entry, kind) {
    const isNew = !peers.has(entry.userId);
    peers.set(entry.userId, { entry, kind, lastSeen: Date.now() });
    return isNew;
  }

  function removePeer(userId) {
    const peer = peers.get(userId);
    if (!peer) return;
    peers.delete(userId);
    events.emit('leave', [peer.entry]);
    emitPresence();
  }

  // ---------- 其他分頁 ----------
  function post(message) {
    try {
      channel?.postMessage(message);
    } catch {
      // 分頁正在關閉時可能會失敗，沒關係
    }
  }

  function onTabMessage(event) {
    const msg = event.data;
    if (!online || !msg || typeof msg !== 'object') return;
    if (msg.from && msg.from === me?.userId) return;

    switch (msg.type) {
      case 'hello': // 有分頁剛進來：加進名單，並回報自己
      case 'here':  // 回覆「我原本就在」
      case 'beat': { // 定時的「我還在」
        if (!msg.entry || typeof msg.entry.userId !== 'string') return;
        const isNew = addPeer(msg.entry, 'tab');
        if (isNew) {
          // 只有「剛進來」才算有人加入。背景分頁的回覆可能晚好幾秒才到，
          // 那時對方其實原本就在，只更新名單，不顯示進入提示。
          if (msg.type === 'hello') events.emit('join', [msg.entry]);
          emitPresence();
        }
        if (msg.type === 'hello') post({ type: 'here', from: me.userId, entry: me });
        break;
      }
      case 'bye':
        removePeer(msg.from);
        break;
      case 'chat':
        if (peers.get(msg.from)) peers.get(msg.from).lastSeen = Date.now();
        events.emit('message', msg.payload);
        break;
      default:
        break;
    }
  }

  function openChannel() {
    if (typeof BroadcastChannel === 'undefined' || channel) return;
    channel = new BroadcastChannel(TAB_CHANNEL);
    channel.addEventListener('message', onTabMessage);
  }

  function closeChannel() {
    if (!channel) return;
    channel.removeEventListener('message', onTabMessage);
    channel.close();
    channel = null;
  }

  function pruneTabs() {
    const now = Date.now();
    for (const [userId, peer] of peers) {
      if (peer.kind === 'tab' && now - peer.lastSeen > TAB_TIMEOUT_MS) removePeer(userId);
    }
  }

  // ---------- 假的使用者 ----------
  function botCount() {
    let n = 0;
    for (const p of peers.values()) if (p.kind === 'bot') n += 1;
    return n;
  }

  function freeBotName() {
    const used = new Set([...peers.values()].filter((p) => p.kind === 'bot').map((p) => p.entry.nickname));
    const free = BOT_NAMES.filter((n) => !used.has(n));
    return free.length ? pick(free) : null;
  }

  function botJoin({ quiet = false } = {}) {
    const nickname = freeBotName();
    if (!nickname) return;
    const entry = { userId: createId(), nickname, joinedAt: Date.now() - (quiet ? Math.floor(randomBetween(60000, 900000)) : 0) };
    addPeer(entry, 'bot');
    if (!quiet) {
      events.emit('join', [entry]);
      emitPresence();
    }
  }

  function botSpeak() {
    const list = [...peers.values()].filter((p) => p.kind === 'bot');
    if (!list.length) return;
    const bot = pick(list).entry;
    events.emit('message', { v: 1, id: createId(), userId: bot.userId, nickname: bot.nickname, text: pick(BOT_LINES) });
  }

  function botLeave() {
    const list = [...peers.values()].filter((p) => p.kind === 'bot');
    if (list.length <= 1) return;
    removePeer(pick(list).entry.userId);
  }

  function scheduleBot() {
    later(() => {
      if (online) {
        const roll = Math.random();
        const n = botCount();
        if (roll < 0.15 && n < 6) botJoin();
        else if (roll < 0.25 && n > 2) botLeave();
        else botSpeak();
      }
      scheduleBot();
    }, randomBetween(5000, 12000));
  }

  // ---------- 連線 ----------
  function goOnline() {
    online = true;
    openChannel();
    post({ type: 'hello', from: me.userId, entry: me });

    // 等其他分頁回報，再一次告訴畫面層名單（就像 Supabase 一樣）
    return new Promise((resolve) => {
      later(() => {
        if (!online) return resolve(false);
        if (bots && !botsSeeded) {
          botsSeeded = true;
          const n = 2 + Math.floor(Math.random() * 2);
          for (let i = 0; i < n; i += 1) botJoin({ quiet: true });
        }
        const existing = [...peers.values()].map((p) => p.entry);
        if (existing.length) events.emit('join', existing);
        emitPresence();
        events.emit('status', 'connected');
        resolve(true);
      }, HELLO_WAIT_MS);
    });
  }

  function goOffline() {
    online = false;
    // 斷線時收不到其他分頁的消息；連回來後重新打招呼
    for (const [userId, peer] of peers) if (peer.kind === 'tab') peers.delete(userId);
  }

  function simulateDisconnect() {
    if (!online) return;
    goOffline();
    closeChannel();
    events.emit('status', 'reconnecting');
    later(async () => {
      if (!me) return;
      events.emit('status', 'connecting');
      await goOnline();
    }, 10000);
  }

  return {
    on: events.on,

    connect(profile) {
      me = { userId: profile.userId, nickname: profile.nickname, joinedAt: profile.joinedAt };
      events.emit('status', 'connecting');

      return new Promise((resolve, reject) => {
        later(async () => {
          if (!me) return reject(new Error('left'));
          if (test === 'fail' && !failTested) {
            failTested = true;
            events.emit('status', 'failed');
            reject(new Error('mock: first connection fails (?test=fail)'));
            return;
          }
          const ok = await goOnline();
          if (!ok) return reject(new Error('left'));

          every(() => {
            if (!online) return;
            post({ type: 'beat', from: me.userId, entry: me });
            pruneTabs();
          }, HEARTBEAT_MS);
          if (bots) scheduleBot();
          if (test === 'disconnect' && !disconnectTested) {
            disconnectTested = true;
            later(simulateDisconnect, 15000);
          }
          resolve();
        }, 500);
      });
    },

    send(payload) {
      if (!online) return Promise.resolve({ ok: false });
      post({ type: 'chat', from: me.userId, payload });
      return new Promise((resolve) => {
        later(() => resolve({ ok: online }), 120);
      });
    },

    leave() {
      if (me && online) post({ type: 'bye', from: me.userId });
      online = false;
      me = null;
      clearTimers();
      closeChannel();
      peers.clear();
      events.clear();
    },
  };
}
