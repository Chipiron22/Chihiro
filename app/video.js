'use strict';

/* ---------- 動画分析(姿勢測定・フォーム写真・Claudeへの相談) ---------- */
const POSE_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const POSE_MODEL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
const PHASES_VA = { stance: '構え', impact: '打つ瞬間', other: 'その他' };
const SKELETON = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28]];

let poseLandmarker = null, poseLoading = null;
function loadPose() {
  if (poseLandmarker) return Promise.resolve(poseLandmarker);
  if (!poseLoading) {
    poseLoading = (async () => {
      const mod = await import(`${POSE_CDN}/vision_bundle.mjs`);
      const files = await mod.FilesetResolver.forVisionTasks(`${POSE_CDN}/wasm`);
      return poseLandmarker = await mod.PoseLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: POSE_MODEL }, runningMode: 'IMAGE', numPoses: 4,
      });
    })().catch(e => { poseLoading = null; throw e; });
  }
  return poseLoading;
}

/* 3点A-B-Cのうち、Bの角度(度) */
function angleAt(a, b, c) {
  if (!a || !b || !c) return null;
  const v1 = [a.x - b.x, a.y - b.y], v2 = [c.x - b.x, c.y - b.y];
  const m = Math.hypot(...v1) * Math.hypot(...v2);
  if (!m) return null;
  return Math.round(Math.acos(Math.max(-1, Math.min(1, (v1[0] * v2[0] + v1[1] * v2[1]) / m))) * 180 / Math.PI);
}

function measurePose(lm, W, H, hand) {
  const P = i => lm[i] && (lm[i].visibility ?? 1) > 0.5 ? { x: lm[i].x * W, y: lm[i].y * H } : null;
  const R = hand !== 'left'; // ラケットを持つ側
  const [sh, el, wr, hip] = R ? [12, 14, 16, 24] : [11, 13, 15, 23];
  const sM = P(11) && P(12) && { x: (P(11).x + P(12).x) / 2, y: (P(11).y + P(12).y) / 2 };
  const hM = P(23) && P(24) && { x: (P(23).x + P(24).x) / 2, y: (P(23).y + P(24).y) / 2 };
  return {
    elbow: angleAt(P(sh), P(el), P(wr)),
    arm: angleAt(P(hip), P(sh), P(el)),
    kneeL: angleAt(P(23), P(25), P(27)),
    kneeR: angleAt(P(24), P(26), P(28)),
    trunk: sM && hM ? Math.round(Math.atan2(Math.abs(sM.x - hM.x), Math.abs(sM.y - hM.y)) * 180 / Math.PI) : null,
  };
}

/* 場面ごとの目安コメント(診断ではなくヒント) */
function adviceFor(a, phase) {
  const out = [], knees = [a.kneeL, a.kneeR].filter(v => v != null);
  if (phase === 'stance') {
    if (knees.length) {
      const k = Math.min(...knees);
      out.push(k > 165 ? '膝がほぼのびています。少し曲げると、すばやく動き出せます。'
        : k > 150 ? 'もう少し膝を曲げると、動き出しやすくなります。'
        : k >= 100 ? '膝がしっかり曲がっていて、動き出しやすい姿勢です。'
        : '膝を深く曲げすぎているかもしれません。腰が落ちすぎていないか確認しましょう。');
    }
    if (a.trunk != null && a.trunk > 25) out.push('体が横に倒れています。背すじを起こして構えましょう。');
  } else if (phase === 'impact') {
    if (a.elbow != null) out.push(a.elbow >= 160 ? 'ひじがしっかりのびていて、高い打点で打てています。'
      : 'ひじが曲がっています。腕をのばして高い位置で打てると、強い球になります。');
    if (a.arm != null) out.push(a.arm >= 130 ? '腕が高く上がっています。' : '腕の上がりが低めです。打点を高くすることを意識しましょう。');
  }
  return out;
}

/* ---------- 複数人が写っているとき ---------- */
function personBox(lm) {
  const v = lm.filter(p => (p.visibility ?? 1) > 0.3);
  if (!v.length) return null;
  const xs = v.map(p => p.x), ys = v.map(p => p.y);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}
function personCenter(lm) {
  const b = personBox(lm);
  return b ? { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 } : { x: 0.5, y: 0.5 };
}
const boxArea = b => b ? (b.x1 - b.x0) * (b.y1 - b.y0) : 0;
function drawBadge(ctx, lm, W, H, n, selected) {
  const b = personBox(lm); if (!b) return;
  const s = Math.max(2, W / 320);
  ctx.save();
  ctx.lineWidth = s * 1.2; ctx.strokeStyle = selected ? '#22d3ee' : 'rgba(255,255,255,.8)';
  ctx.setLineDash(selected ? [] : [s * 3, s * 3]);
  ctx.strokeRect(b.x0 * W, b.y0 * H, (b.x1 - b.x0) * W, (b.y1 - b.y0) * H);
  ctx.setLineDash([]);
  ctx.fillStyle = selected ? '#22d3ee' : '#475569';
  const r = s * 7; ctx.beginPath(); ctx.arc(b.x0 * W + r, b.y0 * H + r, r, 0, 7); ctx.fill();
  ctx.fillStyle = selected ? '#04211e' : '#fff'; ctx.font = `bold ${s * 8}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(String(n), b.x0 * W + r, b.y0 * H + r + 1);
  ctx.restore();
}

const showAngle = v => v == null ? '見えていません' : v + '°';
function angleSummary(a, hand) {
  return `ラケット腕のひじ ${showAngle(a.elbow)}、腕の上がり ${showAngle(a.arm)}、左膝 ${showAngle(a.kneeL)}、右膝 ${showAngle(a.kneeR)}、体の傾き ${a.trunk == null ? '見えていません' : a.trunk + '°'}(利き手: ${hand === 'left' ? '左' : '右'})`;
}

function drawPose(ctx, lm, W, H, a, hand) {
  const s = Math.max(2, W / 320);
  ctx.lineWidth = s * 1.5; ctx.strokeStyle = '#22d3ee'; ctx.fillStyle = '#f59e0b';
  const ok = i => lm[i] && (lm[i].visibility ?? 1) > 0.5;
  SKELETON.forEach(([i, j]) => {
    if (!ok(i) || !ok(j)) return;
    ctx.beginPath(); ctx.moveTo(lm[i].x * W, lm[i].y * H); ctx.lineTo(lm[j].x * W, lm[j].y * H); ctx.stroke();
  });
  [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28].forEach(i => {
    if (!ok(i)) return; ctx.beginPath(); ctx.arc(lm[i].x * W, lm[i].y * H, s * 1.6, 0, 7); ctx.fill();
  });
  ctx.font = `bold ${s * 7}px sans-serif`; ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = s * 1.2;
  [[hand === 'left' ? 13 : 14, a.elbow], [25, a.kneeL], [26, a.kneeR]].forEach(([i, v]) => {
    if (v == null || !ok(i)) return;
    const x = lm[i].x * W + s * 4, y = lm[i].y * H;
    ctx.strokeText(v + '°', x, y); ctx.fillText(v + '°', x, y);
  });
}

/* ---------- AIコーチ(中継サーバー経由) ---------- */
const aiCfg = () => state.settings.ai || {};
const aiReady = () => /^https:\/\//.test(aiCfg().url || '') && !!aiCfg().key;
// 動画の現在のコマを、AIに送るサイズのJPEG(base64)にする。rect(0〜1の割合)があれば、その枠の周りだけを切り抜く
function frameB64(video, rect) {
  const vw = video.videoWidth, vh = video.videoHeight;
  let sx = 0, sy = 0, sw = vw, sh = vh;
  if (rect) {
    const m = 0.08; // 枠の周りに少しゆとりを持たせる
    const x0 = Math.max(0, rect.x - rect.w * m), y0 = Math.max(0, rect.y - rect.h * m);
    const x1 = Math.min(1, rect.x + rect.w * (1 + m)), y1 = Math.min(1, rect.y + rect.h * (1 + m));
    sx = x0 * vw; sy = y0 * vh; sw = (x1 - x0) * vw; sh = (y1 - y0) * vh;
  }
  const k = Math.min(1, 1024 / Math.max(sw, sh)), c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(sw * k)); c.height = Math.max(1, Math.round(sh * k));
  c.getContext('2d').drawImage(video, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.8).split(',')[1];
}
const seekTo = (v, t) => new Promise(res => {
  if (Math.abs(v.currentTime - t) < 0.001) return res();
  const h = () => { v.removeEventListener('seeked', h); res(); };
  v.addEventListener('seeked', h); v.currentTime = t;
});

/* ---------- 参考動画の検索リンク ---------- */
const PRACTICE_QUERIES = [
  [/フットワーク/, 'バドミントン フットワーク 小学生 練習'],
  [/素振り|グリップ/, 'バドミントン グリップ 素振り 初心者 小学生'],
  [/体幹|柔軟/, 'バドミントン 体幹トレーニング ジュニア'],
  [/クリア|ドロップ|スマッシュ/, 'バドミントン クリア ドロップ スマッシュ 打ち分け 練習'],
  [/ネット前|ヘアピン/, 'バドミントン ヘアピン ネット前 練習'],
  [/レシーブ|守備/, 'バドミントン レシーブ 守備 練習 ジュニア'],
  [/ゲーム練習|ラリー/, 'バドミントン ゲーム練習 ラリー 組み立て'],
  [/動画|振り返り/, 'バドミントン 試合 分析 振り返り 方法'],
  [/パターン/, 'バドミントン 得意パターン 配球'],
  [/サーブ/, 'バドミントン サーブ レシーブ 練習 小学生'],
  [/睡眠|食事|体調/, 'スポーツ 子ども 試合前 食事 睡眠'],
  [/イメージ|軽め/, 'バドミントン 試合前日 調整 イメージトレーニング'],
];
function practiceQuery(text) {
  const t = String(text).replace(/^【.*?】/, '');
  const hit = PRACTICE_QUERIES.find(([re]) => re.test(t));
  return hit ? hit[1] : `バドミントン 小学生 ${t}`;
}
const ytUrl = q => 'https://www.youtube.com/results?search_query=' + encodeURIComponent(q);
const gUrl = q => 'https://www.google.com/search?q=' + encodeURIComponent(q);
const searchButtons = q => `<a class="btn ghost sm" href="${esc(ytUrl(q))}" target="_blank" rel="noopener noreferrer">▶ YouTubeで探す</a> <a class="btn ghost sm" href="${esc(gUrl(q))}" target="_blank" rel="noopener noreferrer">🔍 Googleで探す</a>`;
const menuCards = menus => (menus || []).length ? `<div style="margin-top:12px"><b>📚 次の練習メニュー</b>${menus.map(m => `<div class="card" style="margin:8px 0 0;padding:12px"><div><b>${esc(m.name)}</b></div><div class="sub">検索: ${esc(m.query)}</div><div class="links">${searchButtons(m.query)}</div></div>`).join('')}</div>` : '';

function linkForm() {
  const f = openForm(`<h3>参考リンクを保存</h3>
    <label class="l">タイトル</label><input type="text" name="title" placeholder="例: ヘアピンの基本" required>
    <label class="l">リンク(URL)</label><input type="text" name="url" inputmode="url" placeholder="https://" autocapitalize="off" required>
    <label class="l">メモ</label><textarea name="note" placeholder="例: 毎日5分やる"></textarea>
    <div class="actions"><button type="button" class="btn ghost" data-close>やめる</button><button class="btn">保存</button></div>`);
  f.onsubmit = e => {
    e.preventDefault();
    const fd = new FormData(f), url = fd.get('url').trim();
    if (!/^https?:\/\//i.test(url)) { toast('リンクは https:// から始めてください'); return; }
    (state.links = state.links || []).unshift({ id: uid(), title: fd.get('title').trim(), url, note: fd.get('note').trim(), date: today() });
    save(); closeForm(); render(); toast('リンクを保存しました');
  };
  f.addEventListener('click', e => { if (e.target.matches('[data-close]')) closeForm(); });
}

/* ---------- 画面(タブ) ---------- */
function videoView() {
  const vids = [
    ...state.practices.map(o => ({ k: 'p', o })), ...state.matches.map(o => ({ k: 'm', o })),
  ].filter(x => x.o.videoId).sort((a, b) => b.o.date.localeCompare(a.o.date));
  const frames = [...(state.frames || [])].sort((a, b) => b.created - a.created);
  return `<div class="card">
      <b>動画を分析する</b>
      <p class="sub">スロー再生とコマ送りで確認し、体の角度を測れます。測定は端末の中だけで行います(初回のみ通信が必要です)。</p>
      <div class="cta" style="margin:0">
        <button class="btn" data-act="video-shoot">📹 撮影して分析</button>
        <button class="btn ghost" data-act="video-pick">📂 動画を選ぶ</button>
      </div>
      <input type="file" id="videoShootFile" accept="video/*" capture="environment" hidden>
      <input type="file" id="videoPickFile" accept="video/*" hidden>
    </div>
    <h2>記録に添付した動画</h2>
    ${vids.length ? vids.map(x => `<div class="card tap" data-act="video-open" data-kind="${x.k}" data-id="${x.o.id}">
        <div class="row sp"><b>🎬 ${fmt(x.o.date)} ${x.k === 'p' ? '練習' : esc(x.o.tournament || '試合')}</b><span class="chip">分析する</span></div>
        ${x.k === 'p' && x.o.memo ? `<div class="sub">${esc(x.o.memo)}</div>` : ''}</div>`).join('')
      : `<div class="card empty">練習や試合の記録に動画を添付すると、ここから分析できます。</div>`}
    <h2>保存したフォーム写真</h2>
    <p class="sub">「Claudeに相談」を押すと、写真と相談文が用意されます。Claudeのチャットに送ると、改善点を教えてもらえます。</p>
    ${frames.length ? frames.map(f => `<div class="card"><div class="row" style="align-items:flex-start">
        <img class="thumb" data-fid="${f.id}" alt="フォーム写真">
        <div class="grow"><b>${esc(f.label || 'フォーム')}</b>
        <div class="sub">${fmt(f.date)} ・ ${PHASES_VA[f.phase] || 'その他'}</div>
        ${f.summary ? `<div class="sub">${esc(f.summary)}</div>` : ''}</div></div>
        <textarea data-frame-note="${f.id}" placeholder="メモ(気になった点など)">${esc(f.note || '')}</textarea>
        <div class="actions"><button class="btn sm" data-act="frame-share" data-id="${f.id}">💬 Claudeに相談</button>
        <button class="btn ghost sm" data-act="frame-dl" data-id="${f.id}">保存</button>
        <button class="btn danger sm" data-act="frame-del" data-id="${f.id}">削除</button></div></div>`).join('')
      : `<div class="card empty">分析画面で「📸 この場面を保存」を押すと、ここに並びます。</div>`}
    <h2>🔖 参考リンク</h2>
    <div class="card">
      <p class="sub">見つけた練習動画やページのリンクを、メモつきで保存できます。</p>
      ${(state.links || []).map(l => `<div class="ms"><div class="grow"><a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer"><b>${esc(l.title)}</b></a>${l.note ? `<div class="sub">${esc(l.note)}</div>` : ''}<div class="sub">${fmt(l.date)}</div></div><button class="btn ghost sm" data-act="link-del" data-id="${l.id}" aria-label="削除">✕</button></div>`).join('')}
      <button class="btn ghost block" data-act="link-add" style="margin-top:8px">＋ リンクを追加</button>
    </div>
    <h2>🤖 AIコーチのアドバイス</h2>
    ${(state.coach || []).length ? state.coach.map(c => `<details class="card"><summary><b>${fmt(c.date)}</b> ${esc(c.label)}</summary>
        <div class="coachbox" style="margin-top:8px">${esc(c.text)}</div>${menuCards(c.menus)}</details>`).join('')
      : `<div class="card empty">分析画面の「🤖 AIコーチに相談」を使うと、アドバイスがここに残ります。</div>`}`;
}

async function videoAfterRender() {
  for (const img of document.querySelectorAll('img[data-fid]')) {
    const blob = await VideoDB.get('img-' + img.dataset.fid).catch(() => null);
    if (blob) img.src = URL.createObjectURL(blob);
  }
}

/* ---------- 分析ダイアログ ---------- */
async function openAnalysis(blob, label, source) {
  if (!blob) { toast('動画を読み込めませんでした'); return; }
  const url = URL.createObjectURL(blob);
  const hand = state.settings.hand || 'right';
  dlg.classList.add('wide');
  dlg.innerHTML = `<div class="f va">
    <div class="row sp"><b>🎬 ${esc(label)}</b><button type="button" class="btn ghost sm" data-va="close">✕ とじる</button></div>
    <video id="vaVideo" controls playsinline src="${url}"></video>
    <div class="row" style="flex-wrap:wrap;margin-top:8px">
      ${[0.25, 0.5, 1].map(r => `<button type="button" class="btn ghost sm" data-va-rate="${r}">${r}倍</button>`).join('')}
      <button type="button" class="btn ghost sm" data-va="prev">◀ 1コマ</button>
      <button type="button" class="btn ghost sm" data-va="next">1コマ ▶</button>
    </div>
    <label class="l">場面</label>
    <div class="chips">${Object.entries(PHASES_VA).map(([k, v], i) => `<label><input type="radio" name="vaPhase" value="${k}" ${i === 0 ? 'checked' : ''}><span>${v}</span></label>`).join('')}</div>
    <label class="l">ラケットを持つ手</label>
    <div class="chips">${[['right', '右手'], ['left', '左手']].map(([k, v]) => `<label><input type="radio" name="vaHand" value="${k}" ${k === hand ? 'checked' : ''}><span>${v}</span></label>`).join('')}</div>
    <div class="actions"><button type="button" class="btn" data-va="measure">🦴 姿勢を測る</button><button type="button" class="btn ghost" data-va="save">📸 この場面を保存</button></div>
    <label class="l">🤖 AIコーチ</label>
    <label class="l" for="vaTarget" style="margin-top:4px">分析する子の目印</label>
    <input type="text" id="vaTarget" placeholder="例: 赤いシャツ・右側のコート" value="${esc(state.settings.target || '')}">
    <div class="actions"><button type="button" class="btn ghost" data-va="pick">🎯 分析する子を枠で囲む</button></div>
    <canvas id="vaPick" hidden></canvas>
    <div id="vaCrop" class="sub"></div>
    <div class="chips" style="margin-top:12px">${[['scene', 'いまの場面'], ['auto', '動画から4枚を自動で']].map(([k, t], i) => `<label><input type="radio" name="vaMode" value="${k}" ${i === 0 ? 'checked' : ''}><span>${t}</span></label>`).join('')}</div>
    <div class="actions"><button type="button" class="btn" data-va="coach">🤖 AIコーチに相談</button></div>
    <div id="vaCoach" class="sub" style="margin-top:8px"></div>
    <canvas id="vaCanvas" hidden></canvas>
    <div id="vaResult" class="sub" style="margin-top:8px">止めたい場面で一時停止し、「姿勢を測る」を押してください。複数人が写っているときは、測る人を選べます。全身が写る横向きや正面の動画だと安定します。</div>
  </div>`;
  const $d = s => dlg.querySelector(s), video = $d('#vaVideo'), cv = $d('#vaCanvas'), res = $d('#vaResult'), coachBox = $d('#vaCoach');
  let measured = null; // { t, a, summary }
  let cropRect = null, pickBase = null; // 分析する子の枠(0〜1の割合)
  let people = [], plain = null, lastCenter = null; // 複数人: 検出した全員 / 元の画像 / 前回選んだ人の位置
  const phase = () => dlg.querySelector('input[name=vaPhase]:checked').value;
  const handNow = () => dlg.querySelector('input[name=vaHand]:checked').value;

  const grab = () => {
    const k = Math.min(1, 1280 / video.videoWidth);
    cv.width = Math.round(video.videoWidth * k); cv.height = Math.round(video.videoHeight * k);
    cv.getContext('2d').drawImage(video, 0, 0, cv.width, cv.height);
  };
  const step = d => { video.pause(); video.currentTime = Math.max(0, Math.min(video.duration || 0, video.currentTime + d / 30)); };

  /* i番目の人を測って結果を表示(複数人のときは選び直せる) */
  const showPerson = (i, ask) => {
    const ctx = cv.getContext('2d'), W = cv.width, H = cv.height;
    ctx.putImageData(plain, 0, 0);
    if (people.length > 1) people.forEach((lm, j) => { if (j !== i) drawBadge(ctx, lm, W, H, j + 1, false); });
    const lm = people[i], a = measurePose(lm, W, H, handNow());
    drawPose(ctx, lm, W, H, a, handNow());
    if (people.length > 1) drawBadge(ctx, lm, W, H, i + 1, true);
    lastCenter = personCenter(lm);
    measured = { t: video.currentTime, a, summary: angleSummary(a, handNow()) };
    const picker = people.length > 1 ? `<div style="color:var(--ink)"><b>測る人: ${i + 1}番</b>${ask ? '(違う場合は番号か画像をタップして選び直してください)' : ''}</div>
      <div class="row" style="margin:6px 0">${people.map((_, j) => `<button type="button" class="btn ${j === i ? '' : 'ghost'} sm" data-va-person="${j}">${j + 1}</button>`).join('')}</div>` : '';
    const tips = adviceFor(a, phase());
    res.innerHTML = `${picker}<div style="color:var(--ink)"><b>測定結果</b>
      <div>ラケット腕のひじ: ${showAngle(a.elbow)} ／ 腕の上がり: ${showAngle(a.arm)}</div>
      <div>左膝: ${showAngle(a.kneeL)} ／ 右膝: ${showAngle(a.kneeR)} ／ 体の傾き: ${a.trunk == null ? '見えていません' : a.trunk + '°'}</div>
      ${tips.map(t => `<div>✅ ${esc(t)}</div>`).join('')}
      <div class="sub" style="margin-top:6px">※目安です。カメラの角度で数値は変わります。</div></div>`;
  };
  // 画像をタップした位置にいる人を選ぶ
  cv.addEventListener('click', e => {
    if (people.length < 2) return;
    const r = cv.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    const inside = people.map((lm, i) => ({ i, b: personBox(lm) })).filter(p => p.b && x >= p.b.x0 && x <= p.b.x1 && y >= p.b.y0 && y <= p.b.y1);
    const best = inside.length ? inside.sort((p, q) => boxArea(p.b) - boxArea(q.b))[0].i
      : people.map((lm, i) => ({ i, d: Math.hypot(personCenter(lm).x - x, personCenter(lm).y - y) })).sort((p, q) => p.d - q.d)[0].i;
    showPerson(best, false);
  });

  dlg.onclick = async e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.vaPerson) { showPerson(+b.dataset.vaPerson, false); return; }
    if (b.dataset.vaRate) { video.playbackRate = +b.dataset.vaRate; toast(`${b.dataset.vaRate}倍速`); return; }
    switch (b.dataset.va) {
      case 'close': dlg.close(); break;
      case 'prev': step(-1); break;
      case 'next': step(1); break;
      case 'measure': {
        if (!video.videoWidth) { toast('動画を読み込み中です'); return; }
        video.pause(); b.disabled = true;
        res.textContent = '姿勢を測っています…(初回は準備に少し時間がかかります)';
        try {
          const pose = await loadPose();
          grab();
          const ctx = cv.getContext('2d');
          plain = ctx.getImageData(0, 0, cv.width, cv.height);
          people = pose.detect(cv).landmarks;
          if (!people.length) { res.textContent = '人の姿勢を見つけられませんでした。全身が写っている場面で試してください。'; break; }
          // 前回選んだ人に近い人を自動で選ぶ。初回は一番大きく写っている人
          const ref = lastCenter;
          const pick = people.length === 1 ? 0 : people
            .map((lm, i) => ({ i, d: ref ? Math.hypot(personCenter(lm).x - ref.x, personCenter(lm).y - ref.y) : -boxArea(personBox(lm)) }))
            .sort((p, q) => p.d - q.d)[0].i;
          cv.hidden = false;
          showPerson(pick, people.length > 1 && !ref);
        } catch (err) {
          console.error(err);
          res.textContent = '姿勢の測定を準備できませんでした。通信状況を確認して、もう一度試してください。「📸 この場面を保存」は通信なしで使えます。';
        } finally { b.disabled = false; }
        break;
      }
      case 'pick': {
        if (!video.videoWidth) { toast('動画を読み込み中です'); return; }
        video.pause();
        const pk = $d('#vaPick'), k = Math.min(1, 1024 / video.videoWidth);
        pk.width = Math.round(video.videoWidth * k); pk.height = Math.round(video.videoHeight * k);
        const ctx = pk.getContext('2d'); ctx.drawImage(video, 0, 0, pk.width, pk.height);
        pickBase = ctx.getImageData(0, 0, pk.width, pk.height);
        pk.hidden = false; pk.style.touchAction = 'none'; pk.style.cursor = 'crosshair';
        cropRect = null;
        $d('#vaCrop').textContent = '分析する子を、指でなぞって四角く囲んでください。';
        const pt = ev => { const r = pk.getBoundingClientRect(); return { x: Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height)) }; };
        const box = (a, c) => ({ x: Math.min(a.x, c.x), y: Math.min(a.y, c.y), w: Math.abs(a.x - c.x), h: Math.abs(a.y - c.y) });
        const paint = r => {
          ctx.putImageData(pickBase, 0, 0);
          if (!r) return;
          ctx.fillStyle = 'rgba(245,158,11,.2)'; ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = Math.max(3, pk.width / 200);
          ctx.fillRect(r.x * pk.width, r.y * pk.height, r.w * pk.width, r.h * pk.height);
          ctx.strokeRect(r.x * pk.width, r.y * pk.height, r.w * pk.width, r.h * pk.height);
        };
        let from = null;
        pk.onpointerdown = ev => { pk.setPointerCapture(ev.pointerId); from = pt(ev); };
        pk.onpointermove = ev => { if (from) paint(box(from, pt(ev))); };
        pk.onpointerup = ev => {
          if (!from) return;
          const r = box(from, pt(ev)); from = null;
          if (r.w < 0.05 || r.h < 0.08) { paint(null); $d('#vaCrop').textContent = '枠が小さすぎます。もう少し大きく囲んでください。'; return; }
          cropRect = r; paint(r);
          $d('#vaCrop').innerHTML = '✅ 枠を設定しました。AIにはこの枠の中だけを送ります。<br>動画から4枚を自動で使うときは、動いても入る、少し大きめの枠にしてください。 <button type="button" class="btn ghost sm" data-va="unpick">枠を解除</button>';
        };
        break;
      }
      case 'unpick': cropRect = null; $d('#vaPick').hidden = true; $d('#vaCrop').textContent = '枠を解除しました。'; break;
      case 'coach': {
        if (!aiReady()) { coachBox.innerHTML = '先に「設定」タブの「AIコーチ設定」を入力してください。'; break; }
        if (!video.videoWidth || !isFinite(video.duration)) { toast('動画を読み込み中です'); return; }
        if (!aiCfg().consent && !confirm('写真が外部のAIサービス(Anthropic社)に送られます。お子さんの写真が含まれるため、ご家族で確認のうえ進めてください。続けますか？')) break;
        state.settings.ai = { ...aiCfg(), consent: true }; save();
        b.disabled = true; video.pause();
        coachBox.textContent = 'コーチが写真を見ています…(10〜30秒ほどかかります)';
        try {
          const mode = dlg.querySelector('input[name=vaMode]:checked').value;
          const images = []; let angles = '';
          if (mode === 'auto') {
            const t0 = video.currentTime;
            for (const f of [0.2, 0.4, 0.6, 0.8]) { await seekTo(video, video.duration * f); images.push(frameB64(video, cropRect)); }
            await seekTo(video, t0);
          } else {
            images.push(frameB64(video, cropRect));
            if (measured && Math.abs(measured.t - video.currentTime) <= 0.001) angles = measured.summary;
          }
          const { url, key } = aiCfg();
          const target = $d('#vaTarget').value.trim();
          state.settings.target = target; save();
          const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-access-key': key },
            body: JSON.stringify({ images, phase: PHASES_VA[phase()], hand: handNow(), angles, note: '', target, cropped: !!cropRect }) });
          const out = await r.json().catch(() => ({}));
          if (!r.ok || !out.text) {
            coachBox.innerHTML = `<div>${esc(out.message || 'AIコーチを呼び出せませんでした。')}</div>${out.detail ? `<div class="detail">詳細: ${esc(out.detail)}</div>` : ''}`;
            break;
          }
          (state.coach = state.coach || []).unshift({ id: uid(), date: today(), label, text: out.text, menus: out.menus || [] });
          state.coach = state.coach.slice(0, 50); save();
          coachBox.innerHTML = `<div class="coachbox">${esc(out.text)}</div>${menuCards(out.menus)}
            <div class="sub" style="margin-top:4px">今回 約${out.thisYen}円 ／ 今月 ${out.spentYen}円 / 上限${out.budgetYen}円</div>`;
        } catch (err) {
          console.error(err);
          coachBox.textContent = '通信に失敗しました。設定のURLと通信状況を確認してください。';
        } finally { b.disabled = false; }
        break;
      }
      case 'save': {
        if (!video.videoWidth) { toast('動画を読み込み中です'); return; }
        video.pause();
        if (!measured || Math.abs(measured.t - video.currentTime) > 0.001) { grab(); measured = null; }
        const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.9));
        const id = uid();
        try { await VideoDB.put('img-' + id, blob); } catch { toast('保存できませんでした'); return; }
        (state.frames = state.frames || []).push({
          id, created: Date.now(), date: today(), label: label, phase: phase(),
          time: Math.round(video.currentTime * 100) / 100, summary: measured ? measured.summary : '',
          hand: handNow(), source,
        });
        state.settings.hand = handNow(); save();
        toast('フォーム写真を保存しました 📸');
        break;
      }
    }
  };
  dlg.addEventListener('close', () => { URL.revokeObjectURL(url); dlg.classList.remove('wide'); dlg.onclick = null; if (tab === 'video') render(); }, { once: true });
  dlg.showModal();
}

/* ---------- Claudeへの相談 ---------- */
function coachPrompt(f) {
  return [
    '小学5年生のバドミントン選手のフォーム写真です。',
    `場面: ${PHASES_VA[f.phase] || 'その他'}`,
    ...(f.summary ? [`端末で測った角度(目安): ${f.summary}`] : []),
    ...(f.note ? [`気になっている点: ${f.note}`] : []),
    '',
    '次の順番で、小学生にも分かるやさしい言葉で教えてください。',
    '1. 良い点を2つ',
    '2. 改善点を3つ(優先度の高い順)',
    '3. 家でできる練習を1つ',
  ].join('\n');
}

async function shareFrame(f, download = false) {
  const blob = await VideoDB.get('img-' + f.id).catch(() => null);
  if (!blob) { toast('写真を読み込めませんでした'); return; }
  const file = new File([blob], `form-${f.date}-${f.id}.jpg`, { type: 'image/jpeg' });
  const text = coachPrompt(f);
  if (!download && navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], text }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name; a.click();
  if (download) { toast('写真を保存しました'); return; }
  try { await navigator.clipboard.writeText(text); toast('写真を保存し、相談文をコピーしました。Claudeのチャットに貼って写真を添付してください'); }
  catch { toast('写真を保存しました。Claudeのチャットに添付してください'); }
}

/* ---------- イベント ---------- */
document.addEventListener('click', async e => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const id = el.dataset.id;
  switch (el.dataset.act) {
    case 'video-pick': $('#videoPickFile').click(); break;
    case 'video-shoot': $('#videoShootFile').click(); break;
    case 'link-add': linkForm(); break;
    case 'link-del':
      if (confirm('このリンクを削除しますか？')) { state.links = state.links.filter(l => l.id !== id); save(); render(); }
      break;
    case 'save-ai': {
      const url = $('#aiUrl').value.trim(), key = $('#aiKey').value.trim();
      if (url && !/^https:\/\//.test(url)) { toast('URLは https:// から始めてください'); break; }
      state.settings.ai = { ...aiCfg(), url, key }; save(); toast('AIコーチの設定を保存しました'); break;
    }
    case 'check-ai': {
      const st = $('#aiStatus');
      if (!aiReady()) { st.textContent = '先にURLと合言葉を保存してください。'; break; }
      st.textContent = '確認中…';
      try {
        const r = await fetch(aiCfg().url, { headers: { 'x-access-key': aiCfg().key } }), j = await r.json();
        st.textContent = r.ok ? `今月の利用額: 約${j.spentYen}円 / 上限${j.budgetYen}円` : (j.message || '確認できませんでした。');
      } catch { st.textContent = '通信に失敗しました。URLを確認してください。'; }
      break;
    }
    case 'video-open': {
      const o = (el.dataset.kind === 'p' ? state.practices : state.matches).find(x => x.id === id);
      openAnalysis(await VideoDB.get(o.videoId).catch(() => null), `${fmt(o.date)} ${el.dataset.kind === 'p' ? '練習' : (o.tournament || '試合')}`, el.dataset.kind + ':' + id);
      break;
    }
    case 'frame-share': shareFrame(state.frames.find(f => f.id === id)); break;
    case 'frame-dl': shareFrame(state.frames.find(f => f.id === id), true); break;
    case 'frame-del':
      if (confirm('このフォーム写真を削除しますか？')) {
        await VideoDB.del('img-' + id).catch(() => 0);
        state.frames = state.frames.filter(f => f.id !== id); save(); render();
      }
      break;
  }
});
document.addEventListener('change', e => {
  if ((e.target.id === 'videoPickFile' || e.target.id === 'videoShootFile') && e.target.files[0]) {
    const f = e.target.files[0]; e.target.value = '';
    openAnalysis(f, f.name, 'temp');
  }
  if (e.target.dataset.frameNote) {
    const f = state.frames.find(x => x.id === e.target.dataset.frameNote);
    if (f) { f.note = e.target.value.trim(); save(); }
  }
});
