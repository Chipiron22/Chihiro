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
        baseOptions: { modelAssetPath: POSE_MODEL }, runningMode: 'IMAGE', numPoses: 1,
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

/* ---------- 画面(タブ) ---------- */
function videoView() {
  const vids = [
    ...state.practices.map(o => ({ k: 'p', o })), ...state.matches.map(o => ({ k: 'm', o })),
  ].filter(x => x.o.videoId).sort((a, b) => b.o.date.localeCompare(a.o.date));
  const frames = [...(state.frames || [])].sort((a, b) => b.created - a.created);
  return `<div class="card">
      <b>動画を分析する</b>
      <p class="sub">スロー再生とコマ送りで確認し、体の角度を測れます。測定は端末の中だけで行います(初回のみ通信が必要です)。</p>
      <button class="btn block" data-act="video-pick">📂 スマホの動画を選ぶ</button>
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
      : `<div class="card empty">分析画面で「📸 この場面を保存」を押すと、ここに並びます。</div>`}`;
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
    <canvas id="vaCanvas" hidden></canvas>
    <div id="vaResult" class="sub" style="margin-top:8px">止めたい場面で一時停止し、「姿勢を測る」を押してください。全身が写る横向きや正面の動画だと安定します。</div>
  </div>`;
  const $d = s => dlg.querySelector(s), video = $d('#vaVideo'), cv = $d('#vaCanvas'), res = $d('#vaResult');
  let measured = null; // { t, angles, summary }
  const phase = () => dlg.querySelector('input[name=vaPhase]:checked').value;
  const handNow = () => dlg.querySelector('input[name=vaHand]:checked').value;

  const grab = () => {
    const k = Math.min(1, 1280 / video.videoWidth);
    cv.width = Math.round(video.videoWidth * k); cv.height = Math.round(video.videoHeight * k);
    cv.getContext('2d').drawImage(video, 0, 0, cv.width, cv.height);
  };
  const step = d => { video.pause(); video.currentTime = Math.max(0, Math.min(video.duration || 0, video.currentTime + d / 30)); };

  dlg.onclick = async e => {
    const b = e.target.closest('button'); if (!b) return;
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
          const lm = pose.detect(cv).landmarks[0];
          if (!lm) { res.textContent = '人の姿勢を見つけられませんでした。全身が写っている場面で試してください。'; break; }
          const a = measurePose(lm, cv.width, cv.height, handNow());
          drawPose(cv.getContext('2d'), lm, cv.width, cv.height, a, handNow());
          measured = { t: video.currentTime, a, summary: angleSummary(a, handNow()) };
          const tips = adviceFor(a, phase());
          cv.hidden = false;
          res.innerHTML = `<div style="color:var(--ink)"><b>測定結果</b>
            <div>ラケット腕のひじ: ${showAngle(a.elbow)} ／ 腕の上がり: ${showAngle(a.arm)}</div>
            <div>左膝: ${showAngle(a.kneeL)} ／ 右膝: ${showAngle(a.kneeR)} ／ 体の傾き: ${a.trunk == null ? '見えていません' : a.trunk + '°'}</div>
            ${tips.map(t => `<div>✅ ${esc(t)}</div>`).join('')}
            <div class="sub" style="margin-top:6px">※目安です。カメラの角度で数値は変わります。</div></div>`;
        } catch (err) {
          console.error(err);
          res.textContent = '姿勢の測定を準備できませんでした。通信状況を確認して、もう一度試してください。「📸 この場面を保存」は通信なしで使えます。';
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
  if (e.target.id === 'videoPickFile' && e.target.files[0]) {
    const f = e.target.files[0]; e.target.value = '';
    openAnalysis(f, f.name, 'temp');
  }
  if (e.target.dataset.frameNote) {
    const f = state.frames.find(x => x.id === e.target.dataset.frameNote);
    if (f) { f.note = e.target.value.trim(); save(); }
  }
});
