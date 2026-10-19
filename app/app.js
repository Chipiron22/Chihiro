'use strict';

/* ---------- 定数 ---------- */
const KEY = 'bd-roadmap-v1';
const MENUS = ['フットワーク', '素振り', '基礎打ち', 'ノック', 'ゲーム練習', 'サーブ', '守備(レシーブ)', 'ネット前', '体幹・筋トレ', '走り込み', 'ストレッチ', '動画チェック'];
const CONDS = ['😫', '😕', '😐', '🙂', '😆'];
const DOW = ['日', '月', '火', '水', '木', '金', '土'];

// 大会から逆算した4つの期間（大会日の何日前までか）
const PHASES = [
  { id: 'base', name: '基礎づくり期', from: Infinity, to: 56, color: '🌱',
    themes: ['フットワーク(6方向)を安定させる', '素振りとグリップを固める', '体幹・柔軟で土台をつくる'] },
  { id: 'skill', name: '技術強化期', from: 56, to: 28, color: '🔧',
    themes: ['クリア・ドロップ・スマッシュを打ち分ける', 'ネット前(ヘアピン)の精度を上げる', '守備(レシーブ)を強化する'] },
  { id: 'game', name: '実戦期', from: 28, to: 14, color: '⚔️',
    themes: ['ゲーム練習でラリーを組み立てる', '試合の動画を見て課題を直す', '得意なパターンを1つ決める'] },
  { id: 'peak', name: '調整期', from: 14, to: 0, color: '🎯',
    themes: ['睡眠・食事・体調を整える', 'サーブとレシーブを最終確認する', '軽めの動きとイメージトレーニング'] },
];

/* ---------- ユーティリティ ---------- */
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const today = () => ymd(new Date());
const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return ymd(d); };
const diffDays = (a, b) => Math.round((parse(a) - parse(b)) / 86400000);
const fmt = s => { const d = parse(s); return `${d.getMonth() + 1}/${d.getDate()}(${DOW[d.getDay()]})`; };
const weekStart = s => { const d = parse(s); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return ymd(d); }; // 月曜はじまり

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 1800);
}

/* ---------- データ保存 ---------- */
const blank = () => ({ goals: [], practices: [], matches: [], settings: { name: '', weeklyDays: 4, hand: 'right' }, frames: [], coach: [] });
let state = load();
function load() {
  try { return Object.assign(blank(), JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { return blank(); }
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { toast('保存できませんでした(容量不足)'); }
}

/* 動画はサイズが大きいので IndexedDB に保存 */
const VideoDB = {
  db: null,
  open() {
    if (this.db) return Promise.resolve(this.db);
    return new Promise((res, rej) => {
      const r = indexedDB.open('bd-videos', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('v');
      r.onsuccess = () => res(this.db = r.result);
      r.onerror = () => rej(r.error);
    });
  },
  async tx(mode, fn) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const t = db.transaction('v', mode); const req = fn(t.objectStore('v'));
      t.oncomplete = () => res(req && req.result); t.onerror = () => rej(t.error);
    });
  },
  put(id, blob) { return this.tx('readwrite', s => s.put(blob, id)); },
  get(id) { return this.tx('readonly', s => s.get(id)); },
  del(id) { return this.tx('readwrite', s => s.delete(id)); },
};

/* ---------- 逆算ロジック ---------- */
function phaseOf(daysLeft) {
  return PHASES.find(p => daysLeft <= p.from && daysLeft > p.to) || PHASES[PHASES.length - 1];
}
// 大会日から逆算した各期間の日付範囲
function phaseRanges(goal) {
  return PHASES.map(p => ({
    ...p,
    start: p.from === Infinity ? null : addDays(goal.date, -p.from),
    end: addDays(goal.date, -p.to),
  }));
}
// 今日以降に終わる期間ごとに「やること」を自動生成(あとで編集可)
function makeMilestones(goal) {
  const t = today(), out = [];
  for (const p of phaseRanges(goal)) {
    if (p.end < t && p.id !== 'peak') continue;
    const due = p.end < t ? goal.date : p.end;
    p.themes.forEach(text => out.push({ id: uid(), text: `【${p.name}】${text}`, due, done: false }));
  }
  return out;
}
const nextGoal = () => state.goals.filter(g => g.date >= today()).sort((a, b) => a.date.localeCompare(b.date))[0];
const goalById = id => state.goals.find(g => g.id === id);

/* ---------- 集計 ---------- */
function weekDays(base = today()) {
  const s = weekStart(base);
  return Array.from({ length: 7 }, (_, i) => addDays(s, i));
}
const minutesOn = d => state.practices.filter(p => p.date === d).reduce((a, p) => a + (+p.minutes || 0), 0);
function streak() {
  const days = new Set(state.practices.map(p => p.date));
  let d = today(), n = 0;
  if (!days.has(d)) d = addDays(d, -1); // 今日まだなら昨日から数える
  while (days.has(d)) { n++; d = addDays(d, -1); }
  return n;
}
function matchResult(m) {
  const w = m.games.filter(g => g[0] > g[1]).length, l = m.games.filter(g => g[0] < g[1]).length;
  return w > l ? 'win' : w < l ? 'lose' : 'draw';
}
const RES = { win: '勝ち', lose: '負け', draw: '引き分け' };

/* ---------- 画面 ---------- */
let tab = 'home', goalView = null;
const TITLES = { home: '🏸 ロードマップ', practice: '📝 練習の記録', match: '🏆 試合の記録', goals: '🎯 目標(逆算プラン)', settings: '⚙️ 設定', video: '🎬 動画分析' };

function render() {
  $('#title').textContent = tab === 'home' && state.settings.name ? `🏸 ${state.settings.name}のロードマップ` : TITLES[tab];
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  const v = $('#view');
  v.innerHTML = ({ home: homeView, practice: practiceView, match: matchView, goals: goalsView, settings: settingsView, video: videoView }[tab])();
  if (tab === 'video') videoAfterRender();
  window.scrollTo(0, 0);
}

function homeView() {
  const g = nextGoal(), t = today();
  const days = weekDays(), mins = days.map(minutesOn);
  const max = Math.max(60, ...mins);
  const doneDays = mins.filter(m => m > 0).length, target = state.settings.weeklyDays || 4;
  let goalCard = `<div class="card empty">まだ目標がありません。<br><button class="btn" data-act="new-goal" style="margin-top:10px">🎯 大会を登録する</button></div>`;
  if (g) {
    const left = diffDays(g.date, t), ph = phaseOf(left), ms = g.milestones || [];
    const open = ms.filter(m => !m.done).sort((a, b) => a.due.localeCompare(b.due)).slice(0, 3);
    goalCard = `<div class="card tap" data-act="open-goal" data-id="${g.id}">
      <div class="sub">次の目標</div>
      <div class="row sp"><div><b>${esc(g.name)}</b><div class="sub">${fmt(g.date)}${g.target ? ' ・ ' + esc(g.target) : ''}</div></div>
      <div style="text-align:right"><span class="big">${left}</span><span class="sub"> 日</span></div></div>
      <div class="chip">${ph.color} いまは${ph.name}</div>
      ${open.length ? `<div style="margin-top:8px" class="sub">次にやること</div>` + open.map(m => `<div>・${esc(m.text)} <span class="sub">(${fmt(m.due)}まで)</span></div>`).join('') : ''}
    </div>`;
  }
  return `
    ${goalCard}
    <div class="cta">
      <button class="btn" data-act="new-practice">📝 今日の練習を記録</button>
      <button class="btn ghost" data-act="new-match">🏆 試合を記録</button>
    </div>
    <div class="card">
      <div class="row sp"><b>今週の練習</b><span class="sub">${doneDays} / ${target} 日 ・ 🔥 連続${streak()}日</span></div>
      <div class="progress"><b style="width:${Math.min(100, doneDays / target * 100)}%"></b></div>
      <div class="bars">${days.map((d, i) => `<div class="${d === t ? 'today' : ''}"><i style="height:${mins[i] / max * 70}px"></i>${DOW[parse(d).getDay()]}<br>${mins[i] || '-'}</div>`).join('')}</div>
      <div class="sub" style="text-align:right">単位: 分 ・ 合計 ${mins.reduce((a, b) => a + b, 0)}分</div>
    </div>
    <h2>最近の記録</h2>
    ${recentList()}`;
}

function recentList() {
  const items = [
    ...state.practices.map(p => ({ k: 'p', d: p.date, o: p })),
    ...state.matches.map(m => ({ k: 'm', d: m.date, o: m })),
  ].sort((a, b) => b.d.localeCompare(a.d)).slice(0, 5);
  if (!items.length) return `<div class="card empty">練習や試合を記録すると、ここに表示されます。</div>`;
  return items.map(i => i.k === 'p' ? practiceCard(i.o) : matchCard(i.o)).join('');
}

function practiceCard(p) {
  return `<div class="card tap" data-act="edit-practice" data-id="${p.id}">
    <div class="row sp"><b>📝 ${fmt(p.date)} ・ ${p.minutes || 0}分</b><span>${CONDS[(p.cond || 3) - 1]}</span></div>
    <div>${(p.menus || []).map(m => `<span class="chip">${esc(m)}</span>`).join('')}</div>
    ${p.memo ? `<div class="sub">${esc(p.memo)}</div>` : ''}
    ${p.videoId || p.videoUrl ? `<div class="sub">🎬 動画あり</div>` : ''}
  </div>`;
}
function matchCard(m) {
  const r = matchResult(m), g = m.goalId && goalById(m.goalId);
  return `<div class="card tap" data-act="edit-match" data-id="${m.id}">
    <div class="row sp"><b>🏆 ${fmt(m.date)} ${esc(m.tournament || '試合')}</b><span class="chip ${r}">${RES[r]}</span></div>
    <div>vs ${esc(m.opponent || '相手')} ・ ${m.games.map(x => x.join('-')).join(' / ')}</div>
    ${m.improve ? `<div class="sub">次の課題: ${esc(m.improve)}</div>` : ''}
    ${m.videoId || m.videoUrl ? `<div class="sub">🎬 動画あり</div>` : ''}
    ${g ? `<div class="sub">🎯 ${esc(g.name)}</div>` : ''}
  </div>`;
}

function practiceView() {
  const list = [...state.practices].sort((a, b) => b.date.localeCompare(a.date));
  const total = list.reduce((a, p) => a + (+p.minutes || 0), 0);
  return `<button class="btn block" data-act="new-practice">＋ 練習を記録する</button>
    <div class="sub" style="margin:10px 0">全${list.length}回 ・ 合計 ${Math.floor(total / 60)}時間${total % 60}分</div>
    ${list.length ? list.map(practiceCard).join('') : `<div class="card empty">まだ記録がありません。</div>`}`;
}

function matchView() {
  const list = [...state.matches].sort((a, b) => b.date.localeCompare(a.date));
  const w = list.filter(m => matchResult(m) === 'win').length;
  return `<button class="btn block" data-act="new-match">＋ 試合を記録する</button>
    <div class="sub" style="margin:10px 0">${list.length}試合 ${w}勝 ${list.length - w}敗(引き分け含む)</div>
    ${list.length ? list.map(matchCard).join('') : `<div class="card empty">まだ記録がありません。</div>`}`;
}

function goalsView() {
  if (goalView) return goalDetail(goalById(goalView));
  const sorted = [...state.goals].sort((a, b) => a.date.localeCompare(b.date));
  return `<button class="btn block" data-act="new-goal">＋ 大会・目標を登録する</button>
    <p class="sub">大会の日付を登録すると、そこから逆算して「いつまでに何をするか」を自動で作ります。</p>
    ${sorted.length ? sorted.map(g => {
      const left = diffDays(g.date, today()), ms = g.milestones || [], done = ms.filter(m => m.done).length;
      return `<div class="card tap" data-act="open-goal" data-id="${g.id}">
        <div class="row sp"><b>${esc(g.name)}</b><span class="${left < 0 ? 'sub' : ''}">${left < 0 ? '終了' : 'あと' + left + '日'}</span></div>
        <div class="sub">${fmt(g.date)}${g.target ? ' ・ ' + esc(g.target) : ''}</div>
        <div class="progress"><b style="width:${ms.length ? done / ms.length * 100 : 0}%"></b></div>
        <div class="sub">やること ${done} / ${ms.length}</div></div>`;
    }).join('') : `<div class="card empty">まだ目標がありません。</div>`}`;
}

function goalDetail(g) {
  if (!g) { goalView = null; return goalsView(); }
  const t = today(), left = diffDays(g.date, t), cur = phaseOf(left);
  const ranges = phaseRanges(g), ms = (g.milestones || []).slice().sort((a, b) => a.due.localeCompare(b.due));
  const inGoal = state.practices.filter(p => p.date <= g.date && p.date >= addDays(g.date, -90));
  const mins = inGoal.reduce((a, p) => a + (+p.minutes || 0), 0);
  const matches = state.matches.filter(m => m.goalId === g.id).sort((a, b) => b.date.localeCompare(a.date));
  return `<button class="btn ghost sm" data-act="back-goals">← 一覧にもどる</button>
    <div class="card" style="margin-top:12px">
      <div class="row sp"><div><b style="font-size:18px">${esc(g.name)}</b><div class="sub">${fmt(g.date)}${g.target ? ' ・ 目標: ' + esc(g.target) : ''}</div></div>
      <div style="text-align:right">${left >= 0 ? `<span class="big">${left}</span><span class="sub"> 日</span>` : '<span class="sub">終了</span>'}</div></div>
      <div class="sub" style="margin-top:6px">この大会に向けた練習: ${inGoal.length}回 ・ ${Math.floor(mins / 60)}時間${mins % 60}分</div>
      <div class="actions"><button class="btn ghost sm" data-act="edit-goal" data-id="${g.id}">編集</button></div>
    </div>
    <h2>逆算スケジュール</h2>
    ${ranges.map(p => {
      const cls = left < 0 || p.end < t ? 'past' : p.id === cur.id ? 'now' : '';
      const range = p.start ? `${fmt(p.start)} 〜 ${fmt(p.end)}` : `〜 ${fmt(p.end)}`;
      return `<div class="phase ${cls}"><b>${p.color} ${p.name}</b> <span class="sub">${range}</span>${p.id === cur.id && left >= 0 ? ' <span class="chip">いまここ</span>' : ''}
        <div class="sub">${p.themes.map(esc).join(' / ')}</div></div>`;
    }).join('')}
    <h2>やることリスト</h2>
    <div class="card">${ms.length ? ms.map(m => `<div class="ms ${m.done ? 'done' : ''}">
        <input type="checkbox" data-act="toggle-ms" data-id="${m.id}" ${m.done ? 'checked' : ''} aria-label="完了">
        <div class="grow"><div class="t">${esc(m.text)}</div><div class="sub ${!m.done && m.due < t ? 'over' : ''}">${fmt(m.due)}まで</div></div>
        <button class="btn ghost sm" data-act="del-ms" data-id="${m.id}" aria-label="削除">✕</button></div>`).join('') : '<div class="empty">まだありません</div>'}
      <div class="row" style="margin-top:10px"><input type="text" id="msText" placeholder="自分のやることを追加" class="grow">
      <input type="date" id="msDue" value="${g.date}" style="width:140px"><button class="btn sm" data-act="add-ms">追加</button></div>
    </div>
    <button class="btn ghost block" data-act="regen-ms" style="margin-bottom:12px">おすすめのやることを作り直す</button>
    <h2>この大会の試合</h2>
    ${matches.length ? matches.map(matchCard).join('') : `<div class="card empty">「試合」で記録するときにこの目標を選ぶと、ここに集まります。</div>`}`;
}

function settingsView() {
  const s = state.settings;
  return `<div class="card">
      <label class="l" for="sName">ニックネーム</label><input type="text" id="sName" value="${esc(s.name)}" placeholder="例: ひろと">
      <label class="l" for="sDays">1週間の練習日数の目標</label>
      <select id="sDays">${[1, 2, 3, 4, 5, 6, 7].map(n => `<option ${n === +s.weeklyDays ? 'selected' : ''}>${n}</option>`).join('')}</select>
      <div class="actions"><button class="btn" data-act="save-settings">保存</button></div>
    </div>
    <h2>🤖 AIコーチ設定</h2>
    <div class="card">
      <p class="sub">AIコーチを使うための中継サーバーの設定です。手順は worker/README.md をご覧ください。合言葉はこの端末にだけ保存されます。</p>
      <label class="l" for="aiUrl">中継サーバーのURL</label><input type="text" id="aiUrl" value="${esc((s.ai || {}).url || '')}" placeholder="https://〇〇.workers.dev" autocapitalize="off" autocomplete="off">
      <label class="l" for="aiKey">合言葉</label><input type="password" id="aiKey" value="${esc((s.ai || {}).key || '')}" autocomplete="off">
      <div class="actions"><button class="btn" data-act="save-ai">保存</button><button class="btn ghost" data-act="check-ai">今月の利用額を確認</button></div>
      <div id="aiStatus" class="sub" style="margin-top:8px"></div>
    </div>
    <h2>バックアップ</h2>
    <div class="card">
      <p class="sub">機種変更やデータ保護のため、ときどき書き出しておくと安心です。動画ファイルは含まれません(端末内にのみ保存されます)。</p>
      <div class="actions"><button class="btn ghost" data-act="export">書き出す</button>
      <button class="btn ghost" data-act="import">読み込む</button></div>
      <input type="file" id="importFile" accept="application/json" hidden>
    </div>
    <h2>データの削除</h2>
    <button class="btn danger block" data-act="reset">すべてのデータを削除</button>`;
}

/* ---------- フォーム ---------- */
const dlg = $('#dlg');
function openForm(html) { dlg.innerHTML = `<form class="f" method="dialog">${html}</form>`; dlg.showModal(); return $('form', dlg); }
const closeForm = () => dlg.close();

function videoField(item) {
  return `<label class="l">動画(スマホの動画 または リンク)</label>
    <input type="file" name="videoFile" accept="video/*">
    <input type="text" name="videoUrl" placeholder="YouTube等のリンク(任意)" value="${esc(item?.videoUrl || '')}" style="margin-top:6px">
    <div id="videoPrev"></div>`;
}
async function showVideoPreview(item) {
  const box = $('#videoPrev', dlg);
  if (!item?.videoId || !box) return;
  const blob = await VideoDB.get(item.videoId).catch(() => null);
  if (!blob) return;
  box.innerHTML = `<video controls playsinline src="${URL.createObjectURL(blob)}"></video>
    <label class="l"><input type="checkbox" name="rmVideo"> 保存済みの動画を削除する</label>`;
}
async function applyVideo(form, item) {
  const fd = new FormData(form), file = fd.get('videoFile'), out = { videoUrl: (fd.get('videoUrl') || '').trim(), videoId: item?.videoId || null };
  if (fd.get('rmVideo') && out.videoId) { await VideoDB.del(out.videoId).catch(() => 0); out.videoId = null; }
  if (file && file.size) {
    try { out.videoId = out.videoId || uid(); await VideoDB.put(out.videoId, file); }
    catch { toast('動画を保存できませんでした'); }
  }
  return out;
}

function practiceForm(p) {
  const isNew = !p; p = p || { date: today(), minutes: 60, menus: [], cond: 3, memo: '' };
  const f = openForm(`<h3>${isNew ? '練習を記録' : '練習を編集'}</h3>
    <label class="l">日付</label><input type="date" name="date" value="${p.date}" required>
    <label class="l">練習時間(分)</label><input type="number" name="minutes" value="${p.minutes}" min="0" step="5" inputmode="numeric" required>
    <div class="row" style="margin-top:6px">${[30, 60, 90, 120].map(n => `<button type="button" class="btn ghost sm" data-min="${n}">${n}分</button>`).join('')}</div>
    <label class="l">やった練習</label>
    <div class="chips">${MENUS.map(m => `<label><input type="checkbox" name="menus" value="${esc(m)}" ${p.menus.includes(m) ? 'checked' : ''}><span>${esc(m)}</span></label>`).join('')}</div>
    <label class="l">調子</label>
    <div class="chips conds">${CONDS.map((c, i) => `<label><input type="radio" name="cond" value="${i + 1}" ${(p.cond || 3) === i + 1 ? 'checked' : ''}><span>${c}</span></label>`).join('')}</div>
    <label class="l">今日できたこと・気づき</label><textarea name="memo" placeholder="例: ネット前のヘアピンが安定してきた">${esc(p.memo)}</textarea>
    ${videoField(p)}
    <div class="actions">${isNew ? '' : '<button type="button" class="btn danger" data-del>削除</button>'}<button type="button" class="btn ghost" data-close>やめる</button><button class="btn">保存</button></div>`);
  f.addEventListener('click', e => { if (e.target.dataset.min) f.minutes.value = e.target.dataset.min; });
  f.onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(f), v = await applyVideo(f, p);
    const rec = { id: p.id || uid(), date: fd.get('date'), minutes: +fd.get('minutes') || 0, menus: fd.getAll('menus'), cond: +fd.get('cond') || 3, memo: fd.get('memo').trim(), ...v };
    upsert(state.practices, rec); save(); closeForm(); render(); toast('記録しました 👍');
  };
  wireCommon(f, p, state.practices);
  showVideoPreview(p);
}

function matchForm(m) {
  const isNew = !m; m = m || { date: today(), tournament: '', opponent: '', games: [[0, 0]], good: '', improve: '', goalId: (nextGoal() || {}).id || '' };
  const gs = [...m.games]; while (gs.length < 3) gs.push(['', '']);
  const f = openForm(`<h3>${isNew ? '試合を記録' : '試合を編集'}</h3>
    <label class="l">日付</label><input type="date" name="date" value="${m.date}" required>
    <label class="l">大会・試合名</label><input type="text" name="tournament" value="${esc(m.tournament)}" placeholder="例: 市民大会 2回戦">
    <label class="l">目標(逆算プラン)と紐づける</label>
    <select name="goalId"><option value="">なし</option>${state.goals.map(g => `<option value="${g.id}" ${g.id === m.goalId ? 'selected' : ''}>${esc(g.name)} (${fmt(g.date)})</option>`).join('')}</select>
    <label class="l">対戦相手</label><input type="text" name="opponent" value="${esc(m.opponent)}" placeholder="例: ○○クラブ △△くん">
    <label class="l">スコア(自分 - 相手)</label>
    ${gs.map((g, i) => `<div class="score"><span class="sub">${i + 1}G</span><input type="number" name="me${i}" value="${g[0]}" min="0" inputmode="numeric"><span>-</span><input type="number" name="op${i}" value="${g[1]}" min="0" inputmode="numeric"></div>`).join('')}
    <label class="l">うまくいったこと</label><textarea name="good">${esc(m.good)}</textarea>
    <label class="l">次の課題</label><textarea name="improve" placeholder="例: レシーブから攻めに切りかえるのが遅い">${esc(m.improve)}</textarea>
    ${videoField(m)}
    <div class="actions">${isNew ? '' : '<button type="button" class="btn danger" data-del>削除</button>'}<button type="button" class="btn ghost" data-close>やめる</button><button class="btn">保存</button></div>`);
  f.onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(f), games = [];
    for (let i = 0; i < 3; i++) {
      const a = fd.get('me' + i), b = fd.get('op' + i);
      if (a !== '' && b !== '') games.push([+a, +b]);
    }
    if (!games.length) { toast('スコアを入力してください'); return; }
    const v = await applyVideo(f, m);
    const rec = { id: m.id || uid(), date: fd.get('date'), tournament: fd.get('tournament').trim(), goalId: fd.get('goalId'), opponent: fd.get('opponent').trim(), games, good: fd.get('good').trim(), improve: fd.get('improve').trim(), ...v };
    upsert(state.matches, rec); save(); closeForm(); render(); toast('記録しました 👍');
  };
  wireCommon(f, m, state.matches);
  showVideoPreview(m);
}

function goalForm(g) {
  const isNew = !g; g = g || { name: '', date: addDays(today(), 60), target: '' };
  const f = openForm(`<h3>${isNew ? '大会・目標を登録' : '目標を編集'}</h3>
    <label class="l">大会名</label><input type="text" name="name" value="${esc(g.name)}" placeholder="例: 県小学生バドミントン大会" required>
    <label class="l">大会の日</label><input type="date" name="date" value="${g.date}" required>
    <label class="l">目標(任意)</label><input type="text" name="target" value="${esc(g.target)}" placeholder="例: ベスト8、予選突破">
    ${isNew ? '<p class="sub">登録すると、大会日から逆算した「やること」を自動で作ります。</p>' : ''}
    <div class="actions">${isNew ? '' : '<button type="button" class="btn danger" data-del>削除</button>'}<button type="button" class="btn ghost" data-close>やめる</button><button class="btn">保存</button></div>`);
  f.onsubmit = e => {
    e.preventDefault();
    const fd = new FormData(f);
    const rec = { ...g, id: g.id || uid(), name: fd.get('name').trim(), date: fd.get('date'), target: fd.get('target').trim() };
    if (isNew) rec.milestones = makeMilestones(rec);
    upsert(state.goals, rec); save(); closeForm();
    goalView = rec.id; tab = 'goals'; render(); toast('逆算プランを作りました 🎯');
  };
  f.addEventListener('click', e => {
    if (e.target.matches('[data-del]') && confirm('この目標を削除しますか？(記録した練習・試合は残ります)')) {
      state.goals = state.goals.filter(x => x.id !== g.id);
      state.matches.forEach(m => { if (m.goalId === g.id) m.goalId = ''; });
      save(); closeForm(); goalView = null; render();
    }
    if (e.target.matches('[data-close]')) closeForm();
  });
}

function upsert(arr, rec) { const i = arr.findIndex(x => x.id === rec.id); i >= 0 ? arr[i] = rec : arr.push(rec); }
function wireCommon(f, item, arr) {
  f.addEventListener('click', async e => {
    if (e.target.matches('[data-close]')) closeForm();
    if (e.target.matches('[data-del]') && confirm('この記録を削除しますか？')) {
      if (item.videoId) await VideoDB.del(item.videoId).catch(() => 0);
      arr.splice(arr.findIndex(x => x.id === item.id), 1);
      save(); closeForm(); render();
    }
  });
}

/* ---------- イベント ---------- */
document.addEventListener('click', e => {
  const tb = e.target.closest('#tabs button');
  if (tb) { tab = tb.dataset.tab; goalView = null; render(); return; }
  const el = e.target.closest('[data-act]');
  if (!el || el.matches('input')) return;
  const id = el.dataset.id, g = goalView && goalById(goalView);
  switch (el.dataset.act) {
    case 'new-practice': practiceForm(); break;
    case 'edit-practice': practiceForm(state.practices.find(x => x.id === id)); break;
    case 'new-match': matchForm(); break;
    case 'edit-match': matchForm(state.matches.find(x => x.id === id)); break;
    case 'new-goal': goalForm(); break;
    case 'edit-goal': goalForm(goalById(id)); break;
    case 'open-goal': tab = 'goals'; goalView = id; render(); break;
    case 'back-goals': goalView = null; render(); break;
    case 'add-ms': {
      const text = $('#msText').value.trim(); if (!text || !g) return;
      (g.milestones = g.milestones || []).push({ id: uid(), text, due: $('#msDue').value || g.date, done: false });
      save(); render(); break;
    }
    case 'del-ms': g.milestones = g.milestones.filter(m => m.id !== id); save(); render(); break;
    case 'regen-ms':
      if (confirm('いまのやることリストを、おすすめの内容で作り直します。よろしいですか？')) { g.milestones = makeMilestones(g); save(); render(); }
      break;
    case 'save-settings':
      state.settings.name = $('#sName').value.trim(); state.settings.weeklyDays = +$('#sDays').value;
      save(); render(); toast('保存しました'); break;
    case 'export': {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify({ ...state, settings: { ...state.settings, ai: undefined } }, null, 2)], { type: 'application/json' }));
      a.download = `badminton-${today()}.json`; a.click(); break;
    }
    case 'import': $('#importFile').click(); break;
    case 'reset':
      if (confirm('すべてのデータを削除します。元に戻せません。よろしいですか？')) {
        indexedDB.deleteDatabase('bd-videos'); VideoDB.db = null;
        state = blank(); save(); render(); toast('削除しました');
      }
      break;
  }
});
document.addEventListener('change', e => {
  if (e.target.dataset.act === 'toggle-ms') {
    const g = goalById(goalView), m = g.milestones.find(x => x.id === e.target.dataset.id);
    m.done = e.target.checked; save(); render(); if (m.done) toast('やったね！ 🎉');
  }
  if (e.target.id === 'importFile' && e.target.files[0]) {
    e.target.files[0].text().then(txt => {
      try {
        const d = JSON.parse(txt);
        if (!Array.isArray(d.practices) || !Array.isArray(d.matches) || !Array.isArray(d.goals)) throw 0;
        if (confirm('いまのデータを読み込んだ内容で置き換えます。よろしいですか？')) { state = Object.assign(blank(), d); save(); render(); toast('読み込みました'); }
      } catch { toast('読み込めないファイルです'); }
    });
  }
});

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => 0);
render();
