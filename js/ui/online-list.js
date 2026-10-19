// 在線名單：人數、依進入順序排列、自己後面加「（你）」。
// 手機和電腦用同一份內容，位置由 CSS 決定。

export function createOnlineList() {
  const list = document.getElementById('roster-list');
  const count = document.getElementById('roster-count');

  return {
    /** entries 已經檢查過；同一個 userId 只會出現一次 */
    render(entries, selfUserId) {
      const unique = new Map();
      for (const e of entries) unique.set(e.userId, e);
      const sorted = [...unique.values()].sort(
        (a, b) => a.joinedAt - b.joinedAt || a.userId.localeCompare(b.userId),
      );

      const items = sorted.map((e) => {
        const li = document.createElement('li');
        li.className = 'roster__item';
        if (e.userId === selfUserId) {
          li.classList.add('is-self');
          li.textContent = `${e.nickname}（你）`;
        } else {
          li.textContent = e.nickname;
        }
        return li;
      });

      list.replaceChildren(...items);
      count.textContent = `線上 ${sorted.length} 人`;
    },
    clear() {
      list.replaceChildren();
      count.textContent = '線上 0 人';
    },
  };
}
