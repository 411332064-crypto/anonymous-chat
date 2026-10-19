// 網頁啟動的地方：讀設定、決定用哪個傳訊層，把畫面層和傳訊層接起來。
// 資料流見 docs/architecture.md 第 6 節。

import { config } from './config.js';
import {
  checkOutgoingText,
  parseIncomingMessage,
  parsePresenceEntry,
  createRateLimiter,
  createPerUserLimiter,
  createSeenSet,
  createId,
  loadNickname,
  saveNickname,
} from './chat.js';
import { createEntryScreen } from './ui/entry-screen.js';
import { createChatScreen } from './ui/chat-screen.js';
import { createOnlineList } from './ui/online-list.js';

// ---------- 網址參數（測試用，見架構文件第 4.1 節） ----------
const params = new URLSearchParams(window.location.search);
const useMock = config.mode !== 'supabase' || params.get('mock') === '1';
const testMode = params.get('test'); // 'fail' | 'disconnect' | null
const botsEnabled = params.get('bots') !== '0';

// 要用哪個「插頭」。階段二只要新增 transport/supabase.js、改 config.js。
async function createTransport() {
  if (useMock) {
    const { createMockTransport } = await import('./transport/mock.js');
    return createMockTransport({ bots: botsEnabled, test: testMode });
  }
  const { createSupabaseTransport } = await import('./transport/supabase.js');
  return createSupabaseTransport({
    url: config.supabaseUrl,
    publishableKey: config.supabasePublishableKey,
    channelName: config.channelName,
  });
}

// ---------- 這一次進入聊天室的狀態 ----------
let transport = null;
let session = null;
let transportStatus = 'idle';

function newSession(nickname) {
  return {
    self: { userId: createId(), nickname, joinedAt: Date.now() },
    synced: false, // 收到第一份名單之前的「加入」通知，是原本就在的人，不顯示提示
    seen: createSeenSet(),
    outgoing: createRateLimiter(5, 5000),        // 自己：5 秒內最多 5 則
    incoming: createPerUserLimiter(10, 5000),    // 別人：5 秒內最多 10 則，多的丟掉
  };
}

const onlineList = createOnlineList();

const chatScreen = createChatScreen({
  onSend(raw) {
    if (!session || !transport) return;
    const checked = checkOutgoingText(raw);
    if (!checked.ok) return;
    if (!isConnected()) return;
    if (!session.outgoing.allow()) {
      chatScreen.showRateLimit();
      return;
    }

    const payload = {
      v: 1,
      id: createId(),
      userId: session.self.userId,
      nickname: session.self.nickname,
      text: checked.text,
    };
    session.seen.add(payload.id);

    const handle = chatScreen.addOwnMessage({ nickname: payload.nickname, text: payload.text, time: new Date() });
    chatScreen.clearInput();

    const current = transport;
    current
      .send(payload)
      .then((result) => {
        if (!result?.ok) handle.markFailed();
      })
      .catch(() => handle.markFailed());
  },

  onLeave() {
    leaveRoom();
  },
});

const entryScreen = createEntryScreen({
  onEnter(nickname) {
    enterRoom(nickname);
  },
});

function isConnected() {
  return transportStatus === 'connected' && navigator.onLine !== false;
}

function refreshConnection() {
  chatScreen.setConnected(isConnected());
}

// ---------- 接上傳訊層的通知 ----------
function wire(t) {
  t.on('status', (status) => {
    if (t !== transport) return;
    transportStatus = status;
    // 斷線後重新連上時，Supabase 會重新告訴我們「原本就在的人」，不要當成有人進來
    if (status !== 'connected' && session) session.synced = false;
    refreshConnection();
  });

  t.on('presence', (entries) => {
    if (t !== transport || !session) return;
    const valid = (Array.isArray(entries) ? entries : []).map(parsePresenceEntry).filter(Boolean);
    onlineList.render(valid, session.self.userId);
    session.synced = true;
  });

  t.on('join', (entries) => {
    if (t !== transport || !session || !session.synced) return;
    for (const raw of entries ?? []) {
      const entry = parsePresenceEntry(raw);
      if (entry && entry.userId !== session.self.userId) chatScreen.addNotice(`${entry.nickname} 進入了聊天室`);
    }
  });

  t.on('leave', (entries) => {
    if (t !== transport || !session || !session.synced) return;
    for (const raw of entries ?? []) {
      const entry = parsePresenceEntry(raw);
      if (entry && entry.userId !== session.self.userId) chatScreen.addNotice(`${entry.nickname} 離開了`);
    }
  });

  t.on('message', (payload) => {
    if (t !== transport || !session) return;
    const message = parseIncomingMessage(payload, session.self.userId);
    if (!message) return;
    if (!session.seen.add(message.id)) return;
    if (!session.incoming.allow(message.userId)) return;
    chatScreen.addMessage({ nickname: message.nickname, text: message.text, time: new Date() });
  });
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

// ---------- 進入、離開 ----------
async function enterRoom(nickname) {
  saveNickname(nickname);
  entryScreen.showError(false);
  entryScreen.setConnecting(true);

  session = newSession(nickname);
  onlineList.clear();
  chatScreen.reset();
  chatScreen.setSelfName(nickname);

  let t;
  try {
    t = await createTransport();
    transport = t;
    transportStatus = 'connecting';
    wire(t);
    await withTimeout(t.connect(session.self), config.connectTimeoutMs);
  } catch (err) {
    console.warn('[chat] connect failed:', err?.message ?? err);
    t?.leave();
    if (transport === t) transport = null;
    session = null;
    transportStatus = 'idle';
    entryScreen.setConnecting(false);
    entryScreen.showError(true);
    return;
  }

  if (transport !== t) return; // 連線途中已經離開了
  entryScreen.setConnecting(false);
  entryScreen.hide();
  refreshConnection();
  chatScreen.show();
}

function leaveRoom() {
  transport?.leave();
  transport = null;
  transportStatus = 'idle';
  session = null;
  chatScreen.hide();
  chatScreen.reset();
  onlineList.clear();
  entryScreen.show({ nickname: loadNickname(), demo: useMock });
}

// 網路斷了／回來了（瀏覽器會通知）
window.addEventListener('offline', refreshConnection);
window.addEventListener('online', refreshConnection);

// 關掉分頁時盡量通知其他人（來不及也沒關係，伺服器會自己發現）
window.addEventListener('pagehide', () => {
  transport?.leave();
});

// 手機按「上一頁」再回來時，網頁可能是從快取還原的，連線已經斷了：回到進入畫面
window.addEventListener('pageshow', (event) => {
  if (event.persisted && session) leaveRoom();
});

// ---------- 開始 ----------
entryScreen.show({ nickname: loadNickname(), demo: useMock });
// 給自動測試用：看到這個記號就代表程式已經準備好了
document.documentElement.dataset.ready = 'true';
