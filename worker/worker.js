// バドミントン ロードマップ用 AIコーチ中継サーバー (Cloudflare Worker)
//
// 役割:
//  1. APIキーをアプリに書かずに済むよう、キーをここだけに保管する
//  2. 合言葉(ACCESS_KEY)を知っている人だけに使わせる
//  3. 1か月の利用額が上限(BUDGET_YEN)に達したら、それ以降の呼び出しを止める
//
// 必要な設定は worker/README.md を参照してください。

const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-5-5';
const PRICE_USD_PER_MTOK = { in: 2, out: 10 }; // claude-sonnet-5-5
const MAX_IMAGES = 4;
const MAX_IMAGE_B64 = 1_800_000; // 1枚あたりのbase64文字数の上限
const MAX_TOKENS = 3000;

const SYSTEM = `あなたは小学生のバドミントン選手を教えるコーチです。小学5年生のお子さんと保護者に向けて、やさしい日本語で助言します。

送られてくる写真は、練習や試合の動画から切り出した場面です。写真に写っていることだけをもとに話し、見えないことは推測せずに「この写真では分かりません」と伝えてください。
角度の数値が添えられている場合は、カメラの向きで変わる目安として扱ってください。

次の形で、全体を600文字以内にまとめてください。
【良いところ】2つ
【直すところ】3つ(大切な順。1つずつ理由を短く添える)
【おうちでできる練習】1つ(道具が少なく、安全にできるもの)
【ひとこと】前向きに終わる励ましの言葉

注意:
- 成長期なので、無理な回数や負担の大きい練習は勧めないでください。
- 痛みやケガについて診断はせず、気になる場合は大人と一緒に医師へ相談するよう伝えてください。
- 他人と比べず、本人の成長に目を向けた言い方にしてください。
- 記号の装飾(**や#)は使わず、読みやすい文章にしてください。`;

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
    const cors = {
      'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : (allowed[0] || ''),
      'Access-Control-Allow-Headers': 'content-type, x-access-key',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      Vary: 'Origin',
    };
    const json = (obj, status = 200) =>
      new Response(JSON.stringify(obj), { status, headers: { ...cors, 'content-type': 'application/json; charset=utf-8' } });

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (!allowed.length || !allowed.includes(origin)) return json({ error: 'origin', message: '許可されていないアクセス元です。' }, 403);
    if (!env.ACCESS_KEY || !safeEqual(request.headers.get('x-access-key') || '', env.ACCESS_KEY)) {
      return json({ error: 'key', message: '合言葉が違います。' }, 401);
    }
    if (!env.USAGE) return json({ error: 'config', message: '利用額の記録場所(USAGE)が未設定です。' }, 500);
    if (!env.ANTHROPIC_API_KEY) return json({ error: 'config', message: 'APIキーが未設定です。' }, 500);

    const budget = Number(env.BUDGET_YEN) || 300;
    const yenPerUsd = Number(env.YEN_PER_USD) || 150;
    const monthKey = 'spend:' + monthJst();
    const spent = Number(await env.USAGE.get(monthKey)) || 0;

    if (request.method === 'GET') return json({ spentYen: round1(spent), budgetYen: budget });
    if (request.method !== 'POST') return json({ error: 'method' }, 405);

    if (spent >= budget) {
      return json({ error: 'budget', message: `今月の上限(${budget}円)に達しました。来月1日から使えます。`, spentYen: round1(spent), budgetYen: budget }, 429);
    }

    let body;
    try { body = await request.json(); } catch { return json({ error: 'bad_request', message: '送信内容を読み取れませんでした。' }, 400); }
    const images = Array.isArray(body.images) ? body.images : [];
    if (!images.length || images.length > MAX_IMAGES) return json({ error: 'bad_request', message: `写真は1〜${MAX_IMAGES}枚にしてください。` }, 400);
    if (images.some(s => typeof s !== 'string' || s.length > MAX_IMAGE_B64 || !/^[A-Za-z0-9+/=]+$/.test(s))) {
      return json({ error: 'bad_request', message: '写真の形式が正しくありません。' }, 400);
    }

    const text = [
      `場面: ${clip(body.phase, 20) || '指定なし'}`,
      `ラケットを持つ手: ${body.hand === 'left' ? '左手' : '右手'}`,
      images.length > 1 ? `写真は動画から等間隔に取り出した${images.length}枚です(古い順)。` : '',
      body.angles ? `端末で測った角度(目安): ${clip(body.angles, 300)}` : '',
      body.note ? `保護者・本人のメモ: ${clip(body.note, 300)}` : '',
      '',
      'この写真から、フォームの良いところと直すところを教えてください。',
    ].filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n');

    const call = withFallback => fetch(API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        ...(withFallback ? { 'anthropic-beta': 'server-side-fallback-2026-07-01' } : {}),
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        ...(withFallback ? { fallbacks: 'default' } : {}),
        output_config: { effort: 'medium' },
        system: SYSTEM,
        messages: [{
          role: 'user',
          content: [
            ...images.map(data => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } })),
            { type: 'text', text },
          ],
        }],
      }),
    });

    let upstream = await call(true);
    let data = await upstream.json().catch(() => null);
    // 予備モデルへの切り替え設定が通らない場合は、その設定なしでもう一度試す
    if (upstream.status === 400 && /fallback|beta/i.test((data && data.error && data.error.message) || '')) {
      upstream = await call(false);
      data = await upstream.json().catch(() => null);
    }
    if (!upstream.ok || !data) {
      const code = data && data.error && data.error.type;
      const msg = (data && data.error && data.error.message) || '';
      if (/reached your specified/i.test(msg) || (data && data.error && data.error.details && data.error.details.error_code === 'enforced_spend_limit_reached')) {
        return json({ error: 'budget', message: 'Anthropic側の利用上限に達しました。', spentYen: round1(spent), budgetYen: budget }, 429);
      }
      return json({
        error: 'upstream',
        message: 'AIコーチを呼び出せませんでした。時間をおいてもう一度お試しください。',
        detail: `${upstream.status} ${code || ''} ${msg}`.trim().slice(0, 300),
      }, 502);
    }

    // 利用額を記録(失敗しても結果は返す)
    const u = data.usage || {};
    const inTok = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0) * 0.1;
    const usd = (inTok * PRICE_USD_PER_MTOK.in + (u.output_tokens || 0) * PRICE_USD_PER_MTOK.out) / 1e6;
    const yen = usd * yenPerUsd;
    const total = spent + yen;
    try { await env.USAGE.put(monthKey, String(total), { expirationTtl: 60 * 60 * 24 * 70 }); } catch { /* 記録失敗は無視 */ }

    if (data.stop_reason === 'refusal') {
      return json({ error: 'refusal', message: 'この写真にはお答えできませんでした。別の場面でお試しください。', spentYen: round1(total), budgetYen: budget }, 422);
    }
    const answer = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    if (!answer) return json({ error: 'empty', message: '回答を受け取れませんでした。もう一度お試しください。', spentYen: round1(total), budgetYen: budget }, 502);
    return json({ text: answer, thisYen: round1(yen), spentYen: round1(total), budgetYen: budget });
  },
};

const round1 = n => Math.round(n * 10) / 10;
const clip = (s, n) => (typeof s === 'string' ? s.slice(0, n) : '');
// 日本時間の「年-月」
function monthJst() {
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
// 時間差で合言葉を推測されないための比較
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
