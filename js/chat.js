// 聊天室的規則：輸入檢查、洗版限制、收到訊息時的檢查、去除重複。
// 這個檔案不碰畫面也不碰網路，兩個階段都共用，行為才會一模一樣。

export const NICKNAME_MAX = 20;
export const MESSAGE_MAX = 500;
export const MESSAGE_VERSION = 1;

/** 字數：一個中文字、英文字母、表情符號都算 1 個字 */
export function countChars(text) {
  return Array.from(text).length;
}

/** 只保留前 max 個字（不會把表情符號切成一半） */
export function truncateChars(text, max) {
  const chars = Array.from(text);
  return chars.length > max ? chars.slice(0, max).join('') : text;
}

// 會被拿來搗亂的隱形字元：控制字元、讓文字反著顯示的字元、零寬空白。
// 保留 \n（換行）和 U+200D（組合表情符號需要它）。
const INVISIBLE_RE = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F؜​‎‏‪-‮⁦-⁩﻿]/g;

/** 清理訊息內容：統一換行、移除隱形字元、連續空行最多保留 2 個 */
export function sanitizeText(text) {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, ' ')
    .replace(INVISIBLE_RE, '')
    .replace(/\n{4,}/g, '\n\n\n');
}

/** 清理代號：不能有換行，前後空白去掉 */
export function sanitizeNickname(text) {
  return text.replace(/[\r\n\t]+/g, ' ').replace(INVISIBLE_RE, '').trim();
}

/** 代號是否合格（傳進來的應該已經清理過） */
export function isValidNickname(nickname) {
  if (typeof nickname !== 'string') return false;
  const n = countChars(nickname);
  return n >= 1 && n <= NICKNAME_MAX;
}

/**
 * 檢查自己要送出的訊息。
 * 回傳 { ok: true, text } 或 { ok: false, reason: 'empty' | 'too-long' }
 */
export function checkOutgoingText(raw) {
  const text = sanitizeText(raw).trim();
  if (text.length === 0) return { ok: false, reason: 'empty' };
  if (countChars(text) > MESSAGE_MAX) return { ok: false, reason: 'too-long' };
  return { ok: true, text };
}

function isShortString(value, max = 64) {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

/**
 * 檢查收到的訊息（任何人都可能直接送奇怪的東西進來，見架構文件第 9 節）。
 * 不合格就回傳 null，合格就回傳清理過的 { id, userId, nickname, text }。
 */
export function parseIncomingMessage(payload, selfUserId) {
  if (!payload || typeof payload !== 'object') return null;
  if (payload.v !== MESSAGE_VERSION) return null;
  const { id, userId, nickname, text } = payload;
  if (!isShortString(id) || !isShortString(userId)) return null;
  // 自己送的訊息不會傳回給自己，寫著我的 UUID 的一定是冒充的
  if (userId === selfUserId) return null;
  if (typeof nickname !== 'string' || nickname.length > 200) return null;
  if (typeof text !== 'string' || text.length > MESSAGE_MAX * 4) return null;

  const cleanName = sanitizeNickname(nickname);
  if (!isValidNickname(cleanName)) return null;
  const cleanText = sanitizeText(text).trim();
  if (cleanText.length === 0 || countChars(cleanText) > MESSAGE_MAX) return null;

  return { id, userId, nickname: cleanName, text: cleanText };
}

/** 檢查在線名單裡的一筆資料，不合格回傳 null */
export function parsePresenceEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const { userId, nickname, joinedAt } = entry;
  if (!isShortString(userId)) return null;
  if (typeof nickname !== 'string' || nickname.length > 200) return null;
  const cleanName = sanitizeNickname(nickname);
  if (!isValidNickname(cleanName)) return null;
  return {
    userId,
    nickname: cleanName,
    joinedAt: Number.isFinite(joinedAt) ? joinedAt : 0,
  };
}

/**
 * 洗版限制：windowMs 毫秒內最多 limit 次。
 * allow() 回傳 true 表示可以，false 表示太快了（被擋下的那次不算數）。
 */
export function createRateLimiter(limit, windowMs, now = () => Date.now()) {
  let times = [];
  return {
    allow() {
      const t = now();
      times = times.filter((x) => t - x < windowMs);
      if (times.length >= limit) return false;
      times.push(t);
      return true;
    },
  };
}

/** 每個人各自一個洗版限制（給收到的訊息用） */
export function createPerUserLimiter(limit, windowMs, now = () => Date.now()) {
  const limiters = new Map();
  return {
    allow(userId) {
      let limiter = limiters.get(userId);
      if (!limiter) {
        limiter = createRateLimiter(limit, windowMs, now);
        limiters.set(userId, limiter);
      }
      return limiter.allow();
    },
  };
}

/** 記住看過的訊息編號，避免重複顯示。只記最近 max 個。 */
export function createSeenSet(max = 2000) {
  const seen = new Set();
  return {
    /** 第一次看到回傳 true，看過了回傳 false */
    add(id) {
      if (seen.has(id)) return false;
      seen.add(id);
      if (seen.size > max) seen.delete(seen.values().next().value);
      return true;
    },
  };
}

/** 24 小時制的「14:05」，用這台裝置自己的時區 */
export function formatTime(date) {
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

/** 產生 UUID。用區網 IP 打開時（不是 https）瀏覽器沒有 randomUUID，就自己組一個。 */
export function createId() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const b = new Uint8Array(16);
  c.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// ---------- 記住上次的代號（localStorage 可能不能用，所以都包起來） ----------
const NICKNAME_KEY = 'ranunculus-hall:nickname';

export function loadNickname() {
  try {
    return globalThis.localStorage?.getItem(NICKNAME_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveNickname(nickname) {
  try {
    globalThis.localStorage?.setItem(NICKNAME_KEY, nickname);
  } catch {
    // 無痕模式等情況存不了，沒關係
  }
}
