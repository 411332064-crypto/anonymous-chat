// 聊天室畫面：訊息區、捲動、新訊息提示、斷線提示、輸入區。
// 所有文字都用 textContent 放進畫面，永遠不會被當成網頁程式碼。

import { MESSAGE_MAX, countChars, formatTime } from '../chat.js';

const MAX_ENTRIES = 500;      // 畫面上最多保留幾則
const BOTTOM_SLACK_PX = 48;   // 離底部多近算「在最底下」
const RATE_NOTICE_MS = 3000;  // 「送太快了」顯示幾毫秒

const FAILED_ICON = '<svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14"><circle cx="7" cy="7" r="5.5"></circle><path d="M7 4 V7.5"></path><path d="M7 10 V10.1"></path></svg>';

export function createChatScreen({ onSend, onLeave }) {
  const root = document.getElementById('chat-screen');
  const selfName = document.getElementById('self-name');
  const leaveButton = document.getElementById('leave-button');
  const banner = document.getElementById('conn-banner');
  const log = document.getElementById('log');
  const empty = document.getElementById('empty-state');
  const pill = document.getElementById('new-pill');
  const pillText = document.getElementById('new-pill-text');
  const form = document.getElementById('composer');
  const input = document.getElementById('message-input');
  const sendButton = document.getElementById('send-button');
  const status = document.getElementById('composer-status');
  const rateNotice = document.getElementById('rate-notice');
  const charCount = document.getElementById('char-count');

  const desktopQuery = window.matchMedia('(hover: hover) and (pointer: fine)');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  let connected = false;
  let unread = 0;
  let rateTimer = null;
  let composing = false;

  // ---------- 捲動 ----------
  function isAtBottom() {
    return log.scrollHeight - log.scrollTop - log.clientHeight <= BOTTOM_SLACK_PX;
  }

  function scrollToBottom({ smooth = false } = {}) {
    log.scrollTo({ top: log.scrollHeight, behavior: smooth && !reducedMotion.matches ? 'smooth' : 'auto' });
    unread = 0;
    pill.hidden = true;
  }

  function bumpUnread() {
    unread += 1;
    pillText.textContent = `有 ${unread} 則新訊息`;
    pill.hidden = false;
  }

  log.addEventListener('scroll', () => {
    if (!pill.hidden && isAtBottom()) {
      unread = 0;
      pill.hidden = true;
    }
  });
  pill.addEventListener('click', () => scrollToBottom({ smooth: true }));

  // 新增一筆到訊息區。自己送的一定捲到底；別人的只有在最底下才自動捲。
  function append(node, { own = false } = {}) {
    const wasAtBottom = isAtBottom();
    log.append(node);
    while (log.childElementCount > MAX_ENTRIES) log.firstElementChild.remove();
    empty.hidden = true;
    if (own || wasAtBottom) scrollToBottom();
    else bumpUnread();
  }

  // ---------- 輸入區 ----------
  function textLength() {
    return countChars(input.value);
  }

  function refreshComposer() {
    const length = textLength();
    const over = length > MESSAGE_MAX;
    const blank = input.value.trim().length === 0;

    charCount.hidden = !over;
    charCount.textContent = `${length} / ${MESSAGE_MAX}`;
    input.classList.toggle('is-over', over);
    input.setAttribute('aria-invalid', over ? 'true' : 'false');
    status.hidden = charCount.hidden && rateNotice.hidden;
    sendButton.disabled = !connected || blank || over;
  }

  // 輸入框跟著內容長高，最高 120px（CSS 的 max-height）
  function autosize() {
    input.style.height = 'auto';
    input.style.height = `${input.scrollHeight + 2}px`;
  }

  function trySend() {
    if (sendButton.disabled) return;
    onSend(input.value);
  }

  input.addEventListener('compositionstart', () => { composing = true; });
  input.addEventListener('compositionend', () => { composing = false; });
  input.addEventListener('input', () => {
    autosize();
    refreshComposer();
  });
  input.addEventListener('keydown', (event) => {
    // 電腦：Enter 送出、Shift+Enter 換行。手機：Enter 就是換行。
    // 選字中（isComposing）按 Enter 是在確認文字，不能送出。
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing || composing || event.keyCode === 229) return;
    if (!desktopQuery.matches) return;
    event.preventDefault();
    trySend();
  });
  // 手機上按「送出」時不要讓輸入框失去焦點，鍵盤才不會收起來又跳出來
  sendButton.addEventListener('pointerdown', (event) => event.preventDefault());
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    trySend();
  });
  leaveButton.addEventListener('click', () => onLeave());

  // ---------- 建立一則訊息 ----------
  function buildMessage({ nickname, text, time, own }) {
    const article = document.createElement('article');
    article.className = own ? 'msg msg--self' : 'msg msg--other';

    const meta = document.createElement('div');
    meta.className = 'msg__meta';
    const name = document.createElement('span');
    name.className = 'msg__name';
    name.textContent = nickname;
    const stamp = document.createElement('time');
    stamp.className = 'msg__time';
    stamp.dateTime = time.toISOString();
    stamp.textContent = formatTime(time);
    meta.append(name, stamp);

    const body = document.createElement('p');
    body.className = 'msg__body';
    body.textContent = text;

    article.append(meta, body);
    return article;
  }

  return {
    show() {
      root.hidden = false;
      refreshComposer();
      autosize();
      if (desktopQuery.matches) input.focus();
    },
    hide() {
      root.hidden = true;
    },
    /** 清空所有訊息和輸入（離開或重新進入時） */
    reset() {
      log.replaceChildren();
      empty.hidden = false;
      unread = 0;
      pill.hidden = true;
      input.value = '';
      clearTimeout(rateTimer);
      rateNotice.hidden = true;
      refreshComposer();
    },
    setSelfName(nickname) {
      selfName.textContent = nickname;
    },
    /** 連線狀態：斷線時顯示提示條，可以打字但不能送出 */
    setConnected(value) {
      connected = value;
      banner.hidden = value;
      refreshComposer();
    },
    /** 別人的訊息 */
    addMessage({ nickname, text, time }) {
      append(buildMessage({ nickname, text, time, own: false }));
    },
    /** 自己的訊息，回傳一個可以標示「未送出」的物件 */
    addOwnMessage({ nickname, text, time }) {
      const article = buildMessage({ nickname, text, time, own: true });
      append(article, { own: true });
      return {
        markFailed() {
          if (article.classList.contains('msg--failed')) return;
          article.classList.add('msg--failed');
          const note = document.createElement('p');
          note.className = 'msg__status';
          note.innerHTML = FAILED_ICON; // 固定的圖示，不含任何使用者輸入
          note.append('未送出');
          article.append(note);
        },
      };
    },
    /** 進出提示：「小明 進入了聊天室」 */
    addNotice(text) {
      const p = document.createElement('p');
      p.className = 'notice';
      const orn = document.createElement('span');
      orn.className = 'notice__orn';
      orn.setAttribute('aria-hidden', 'true');
      orn.textContent = '❧ ';
      p.append(orn, text);
      append(p);
    },
    /** 送出後：清空輸入框，游標留在輸入框 */
    clearInput() {
      input.value = '';
      autosize();
      refreshComposer();
      input.focus();
    },
    /** 「送太快了，稍等一下」，幾秒後自動消失 */
    showRateLimit() {
      rateNotice.hidden = false;
      refreshComposer();
      clearTimeout(rateTimer);
      rateTimer = setTimeout(() => {
        rateNotice.hidden = true;
        refreshComposer();
      }, RATE_NOTICE_MS);
    },
  };
}
