// 設定檔。階段一用模擬模式，階段二才填 Supabase 的資料。
// 這裡只能放可以公開的東西（見 docs/architecture.md 第 8 節）。
// Secret key、service_role key、資料庫密碼絕對不能寫在這裡。

export const config = {
  // 'mock'：模擬模式（階段一）／'supabase'：真的連線（階段二）
  mode: 'mock',

  // 階段二才填，兩個都可以公開
  supabaseUrl: '',
  supabasePublishableKey: '',

  // 頻道名稱，見 docs/architecture.md 第 5.1 節
  channelName: 'anonymous-chat:lobby',

  // 第一次連線最多等幾毫秒
  connectTimeoutMs: 10000,
};
