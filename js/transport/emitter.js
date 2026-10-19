// 傳訊層共用的小工具：讓畫面層可以「訂閱」傳訊層的通知。
//
// ===== 傳訊層的約定（插座規格，見 docs/architecture.md 第 4.0 節） =====
// 每個傳訊層（mock.js、之後的 supabase.js）都要回傳一個物件，包含：
//
//   connect({ userId, nickname, joinedAt })  → Promise，連上就 resolve，連不上就 reject
//   send(payload)                            → Promise<{ ok: boolean }>，payload 格式見第 5.2 節
//   leave()                                  → 離開並切斷連線，可以重複呼叫
//   on(eventName, handler)                   → 訂閱通知，回傳取消訂閱的函式
//
// 通知（eventName）：
//   'status'   (status)    'connecting' | 'connected' | 'reconnecting' | 'failed'
//   'presence' (entries)   目前在線的完整名單：[{ userId, nickname, joinedAt }]
//   'join'     (entries)   有人加入（可能包含自己，畫面層會過濾）
//   'leave'    (entries)   有人離開
//   'message'  (payload)   收到別人的訊息（還沒檢查過，畫面層會檢查）

export function createEmitter() {
  const handlers = new Map();
  return {
    on(event, handler) {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event).add(handler);
      return () => handlers.get(event)?.delete(handler);
    },
    emit(event, ...args) {
      for (const handler of handlers.get(event) ?? []) {
        try {
          handler(...args);
        } catch (err) {
          console.error(`[transport] "${event}" handler failed`, err);
        }
      }
    },
    clear() {
      handlers.clear();
    },
  };
}
