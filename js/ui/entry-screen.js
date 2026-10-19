// 進入畫面：輸入代號、進入、連不上時重試。

import { NICKNAME_MAX, sanitizeNickname, isValidNickname, truncateChars } from '../chat.js';

export function createEntryScreen({ onEnter }) {
  const root = document.getElementById('entry-screen');
  const form = document.getElementById('entry-form');
  const input = document.getElementById('nickname');
  const button = document.getElementById('enter-button');
  const error = document.getElementById('entry-error');
  const retry = document.getElementById('retry-button');
  const demoBanner = document.getElementById('demo-banner');

  let connecting = false;
  let composing = false; // 注音、倉頡等輸入法選字中

  function currentNickname() {
    return sanitizeNickname(input.value);
  }

  function refreshButton() {
    button.disabled = connecting || !isValidNickname(currentNickname());
    button.textContent = connecting ? '連線中…' : '進入';
  }

  // 最多 20 個字。選字中不要截斷，不然輸入法會壞掉。
  function enforceMaxLength() {
    if (composing) return;
    const cut = truncateChars(input.value, NICKNAME_MAX);
    if (cut !== input.value) input.value = cut;
  }

  function submit() {
    if (connecting) return;
    const nickname = currentNickname();
    if (!isValidNickname(nickname)) return;
    input.value = nickname;
    onEnter(nickname);
  }

  input.addEventListener('compositionstart', () => { composing = true; });
  input.addEventListener('compositionend', () => {
    composing = false;
    enforceMaxLength();
    refreshButton();
  });
  input.addEventListener('input', () => {
    enforceMaxLength();
    refreshButton();
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (composing) return; // 選字時按 Enter 是在確認文字，不是送出
    submit();
  });
  retry.addEventListener('click', submit);

  return {
    show({ nickname = '', demo = false } = {}) {
      input.value = truncateChars(nickname, NICKNAME_MAX);
      demoBanner.hidden = !demo;
      root.hidden = false;
      refreshButton();
      // 手機上自動跳出鍵盤會擋住畫面，只有電腦才自動把游標放進去
      if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) input.focus();
    },
    hide() {
      root.hidden = true;
    },
    setConnecting(value) {
      connecting = value;
      input.disabled = value;
      refreshButton();
    },
    showError(value) {
      error.hidden = !value;
      if (value) retry.focus();
    },
  };
}
