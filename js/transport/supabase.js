// Supabase 傳訊層（階段二）。和 mock.js 遵守同一份約定（見 emitter.js 開頭），
// 所以畫面層一行都不用改。
//
// 只用 Supabase Realtime 的兩個功能（見 docs/architecture.md 第 3.4、5 節）：
//   Broadcast：轉送聊天訊息，不會存起來
//   Presence： 記住誰在線上，有人進出時通知大家

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm';
import { createEmitter } from './emitter.js';

const MESSAGE_EVENT = 'chat-message';
const WATCHDOG_MS = 3000; // 每 3 秒檢查一次連線還在不在

/** Supabase 的在線名單是 { key: [資料, …] }，攤平成 [{ userId, nickname, joinedAt }] */
function flattenPresence(state) {
  const list = [];
  for (const metas of Object.values(state ?? {})) {
    if (Array.isArray(metas) && metas.length) list.push(metas[0]);
  }
  return list;
}

export function createSupabaseTransport({ url, publishableKey, channelName }) {
  const events = createEmitter();
  let client = null;
  let channel = null;
  let me = null;
  let status = 'idle';
  let everConnected = false;
  let left = false;
  let watchdog = null;

  function setStatus(next) {
    if (status === next) return;
    status = next;
    events.emit('status', next);
  }

  // 手機切到背景再回來、或連線悄悄斷掉時，Supabase 不一定馬上通知，所以自己定時看一下
  function checkHealth() {
    if (!channel || left || !everConnected) return;
    const socketOk = client.realtime.isConnected();
    const joined = channel.state === 'joined';
    if ((!socketOk || !joined) && status === 'connected') setStatus('reconnecting');
    if (!socketOk) client.realtime.connect(); // 已經在連的話不會重複
  }

  function onVisible() {
    if (document.visibilityState === 'visible') checkHealth();
  }

  return {
    on: events.on,

    connect(profile) {
      if (!url || !publishableKey) {
        return Promise.reject(new Error('Supabase URL or publishable key is missing in js/config.js'));
      }
      me = { userId: profile.userId, nickname: profile.nickname, joinedAt: profile.joinedAt };
      setStatus('connecting');

      client = createClient(url, publishableKey, {
        // 不用登入功能，也不要在瀏覽器裡存任何登入資料
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });

      channel = client.channel(channelName, {
        config: {
          broadcast: { self: false, ack: true },
          presence: { key: me.userId },
        },
      });

      channel.on('broadcast', { event: MESSAGE_EVENT }, ({ payload }) => {
        events.emit('message', payload);
      });
      channel.on('presence', { event: 'sync' }, () => {
        events.emit('presence', flattenPresence(channel.presenceState()));
      });
      channel.on('presence', { event: 'join' }, ({ newPresences }) => {
        events.emit('join', newPresences ?? []);
      });
      channel.on('presence', { event: 'leave' }, ({ leftPresences }) => {
        events.emit('leave', leftPresences ?? []);
      });

      return new Promise((resolve, reject) => {
        let settled = false;

        channel.subscribe(async (state, err) => {
          if (left) return;

          if (state === 'SUBSCRIBED') {
            // 第一次連上、以及每次斷線重連後，都要重新登記自己（用同一個 UUID）
            const result = await channel.track(me);
            if (left) return;
            if (result !== 'ok') {
              console.warn('[supabase] presence track failed:', result);
            }
            everConnected = true;
            setStatus('connected');
            if (!settled) {
              settled = true;
              resolve();
            }
            return;
          }

          if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT' || state === 'CLOSED') {
            if (!settled) {
              // 第一次就連不上：交給畫面層顯示「無法連線」
              settled = true;
              setStatus('failed');
              reject(err ?? new Error(`Supabase channel: ${state}`));
              return;
            }
            // 連上過又斷了：Supabase 程式庫會自己一直重連
            setStatus('reconnecting');
          }
        });

        watchdog = setInterval(checkHealth, WATCHDOG_MS);
        document.addEventListener('visibilitychange', onVisible);
      });
    },

    async send(payload) {
      // 斷線時不要送（Supabase 程式庫在斷線時會改用另一種方式送，我們不要那樣）
      if (!channel || left || status !== 'connected' || channel.state !== 'joined') return { ok: false };
      try {
        const result = await channel.send({ type: 'broadcast', event: MESSAGE_EVENT, payload });
        return { ok: result === 'ok' };
      } catch {
        return { ok: false };
      }
    },

    leave() {
      if (left) return;
      left = true;
      clearInterval(watchdog);
      document.removeEventListener('visibilitychange', onVisible);
      events.clear();
      if (channel) {
        // 先取消登記，其他人才會馬上看到「離開了」；不等回覆，關分頁時也來得及送出
        channel.untrack().catch(() => {});
        client.removeChannel(channel).catch(() => {});
      }
      client?.realtime.disconnect();
      channel = null;
    },
  };
}
