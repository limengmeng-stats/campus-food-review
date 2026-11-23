/* 校园食评 · 前端应用（用户投稿版）
 * 所有美食由同学自己上传：店名 / 菜名 / 标签 / 评分 / 图文 / 匿名
 * 投稿后状态为 pending，只有管理员审核通过后才会公开显示。
 * 已通过投稿按「店名 + 菜名」聚合成一道美食并计算平均分；每条投稿单独展示。
 */

const CONFIG = {
  endpoint: 'https://campus-food-review-75704.app.workbuddy.host',
  oauthRelayBaseUrl: 'https://www.workbuddy.cn/v2/as/genie-baas/oauth',
  publishableKey: 'wbpk_nmawIyegI2a18sLvkYJbFL_wyWINh9a4YRygcSdv2xq2c7zhN1hSoEo',
};

const cloud = WorkBuddyCloud.createWorkBuddyCloud({
  endpoint: CONFIG.endpoint,
  oauthRelayBaseUrl: CONFIG.oauthRelayBaseUrl,
  publishableKey: CONFIG.publishableKey,
});

const app = document.getElementById('app');
const toastEl = document.getElementById('toast');
const modal = document.getElementById('imageModal');

const RATING_LABELS = ['', '很差', '较差', '一般', '满意', '超赞'];
const SORTS = { rating: '评分最高', count: '评价最多', new: '最新上传' };

const state = {
  loaded: false,
  posts: [],        // 已通过的投稿
  foods: [],        // 按 店名+菜名 聚合的美食
  hotTags: [],      // 热门标签
  tag: '全部',
  sort: 'rating',
  keyword: '',
  form: null,
  admin: { authed: false, code: '', posts: [], tab: 'pending', rejecting: null },
};

/* ------------------------------ 工具 ------------------------------ */

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function unwrap(result) {
  if (result && result.error) throw new Error(result.error.message || '请求失败，请稍后重试');
  return result ? result.data : null;
}

function starHtml(rating) {
  const n = Math.round(Number(rating) || 0);
  let out = '';
  for (let i = 1; i <= 5; i++) out += i <= n ? '★' : '<span class="empty">☆</span>';
  return out;
}

function fmtDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function splitTags(str) {
  return String(str || '').split(/[,，、;；\s]+/).map((s) => s.trim()).filter(Boolean).slice(0, 6);
}

let toastTimer = null;
function toast(message) {
  toastEl.textContent = message;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2600);
}

function buildFoods(posts) {
  const map = {};
  posts.forEach((p) => {
    const shop = String(p.shop_name || '').trim() || '未注明店名';
    const dish = String(p.dish_name || '').trim();
    const key = shop + '|' + dish;
    const f = map[key] || (map[key] = {
      key, shopName: shop, dishName: dish,
      sum: 0, count: 0, positive: 0, tags: [], posts: [], cover: null, latest: 0,
    });
    const rating = Number(p.rating) || 0;
    f.sum += rating;
    f.count += 1;
    if (rating >= 4) f.positive += 1;
    splitTags(p.tags).forEach((t) => { if (!f.tags.includes(t)) f.tags.push(t); });
    f.posts.push(p);
    const imgs = Array.isArray(p.images) ? p.images : [];
    if (!f.cover && imgs.length) f.cover = imgs[0];
    const t = new Date(p.created_at).getTime() || 0;
    if (t > f.latest) f.latest = t;
  });
  return Object.keys(map).map((k) => {
    const f = map[k];
    return {
      ...f,
      avg: f.sum / f.count,
      rate: Math.round((f.positive / f.count) * 100),
      posts: f.posts.slice().sort((a, b) => (new Date(b.created_at) || 0) - (new Date(a.created_at) || 0)),
    };
  });
}

function buildHotTags(posts) {
  const m = {};
  posts.forEach((p) => splitTags(p.tags).forEach((t) => { m[t] = (m[t] || 0) + 1; }));
  return Object.keys(m)
    .map((tag) => ({ tag, count: m[tag] }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'zh-CN'))
    .slice(0, 12);
}

function foodOf(key) {
  return state.foods.find((f) => f.key === key) || null;
}

function tagChipsHtml(active, tags) {
  return ['全部'].concat(tags.map((t) => t.tag)).map((t) =>
    `<button class="chip ${t === active ? 'active' : ''}" data-action="tag" data-tag="${esc(t)}">${esc(t === '全部' ? '全部' : '#' + t)}</button>`
  ).join('');
}

/* ------------------------------ 数据 ------------------------------ */

async function loadData(force = false) {
  if (state.loaded && !force) return;
  app.innerHTML = '<div class="center-state"><span class="loading-emoji">🍱</span>正在摆盘，马上上菜…</div>';
  const res = await cloud.database.from('food_posts')
    .select('*').eq('status', 'approved').order('created_at', { ascending: false });
  state.posts = unwrap(res) || [];
  state.foods = buildFoods(state.posts);
  state.hotTags = buildHotTags(state.posts);
  state.loaded = true;
}

function filteredFoods() {
  let list = state.foods.slice();
  if (state.tag !== '全部') list = list.filter((f) => f.tags.includes(state.tag));
  const kw = state.keyword.trim().toLowerCase();
  if (kw) {
    list = list.filter((f) =>
      `${f.shopName} ${f.dishName} ${f.tags.join(' ')}`.toLowerCase().includes(kw)
    );
  }
  if (state.sort === 'count') list.sort((a, b) => b.count - a.count || b.avg - a.avg || b.latest - a.latest);
  else if (state.sort === 'new') list.sort((a, b) => b.latest - a.latest || b.avg - a.avg);
  else list.sort((a, b) => b.avg - a.avg || b.count - a.count || b.latest - a.latest);
  return list;
}

/* ------------------------------ 页面：首页 ------------------------------ */

function renderHome() {
  const ranked = state.foods.slice()
    .sort((a, b) => b.avg - a.avg || b.count - a.count)
    .slice(0, 10);
  const latest = state.foods.slice().sort((a, b) => b.latest - a.latest).slice(0, 4);
  const totalRatings = state.posts.length;
  const overall = totalRatings
    ? (state.posts.reduce((s, p) => s + Number(p.rating || 0), 0) / totalRatings).toFixed(1)
    : '—';
  const tags = state.hotTags;

  app.innerHTML = `
    <section class="hero">
      <h1>分享你吃过的<br>校园好味道</h1>
      <p>同学自己上传 · 真实图文测评 · 只看食物本身</p>
      <div class="hero-tags"><span>📷 自己上传</span><span>⭐ 评分排行</span><span>🏷️ 自由标签</span></div>
    </section>

    <div class="stat-grid">
      <div class="card stat-box"><b>${state.foods.length}</b><span>道美食</span></div>
      <div class="card stat-box"><b>${totalRatings}</b><span>条测评</span></div>
      <div class="card stat-box"><b>${overall}</b><span>全站平均分</span></div>
      <div class="card stat-box"><b>${tags.length}</b><span>个标签</span></div>
    </div>

    <div class="section-head"><h2>热门标签</h2><span class="sub">点选筛选</span></div>
    <div class="chips">${tagChipsHtml(state.tag, tags)}</div>

    <div class="section-head"><h2>好评榜单</h2><span class="sub">按平均分从高到低</span></div>
    <div class="card rank-list">
      ${ranked.length ? ranked.map((f, i) => `
        <a class="rank-item" href="#/food/${encodeURIComponent(f.key)}">
          <span class="rank-no">${i + 1}</span>
          <span class="rank-main">
            <span class="name">${esc(f.dishName)}</span>
            <span class="merchant">${esc(f.shopName)} · 好评率 ${f.rate}%</span>
          </span>
          <span class="rank-score"><span class="stars">${starHtml(f.avg)}</span> <b>${f.avg.toFixed(1)}</b><span class="cnt">${f.count} 人测评</span></span>
        </a>`).join('') : '<div class="center-state tiny">还没有美食，快来上传第一道吧</div>'}
    </div>

    <div class="section-head"><h2>最近上传</h2><a class="sub" href="#/dishes">查看全部 →</a></div>
    <div class="dish-grid">${latest.map(foodCardHtml).join('')}</div>
    <div style="margin-top:18px"><a class="btn btn-primary btn-block" href="#/upload">＋ 上传我吃过的一道美食</a></div>
  `;
}

function foodCardHtml(f) {
  const cover = f.cover
    ? `<img src="${esc(f.cover)}" alt="${esc(f.dishName)}" loading="lazy" style="width:100%;height:110px;object-fit:cover;border-radius:14px 12px 15px 13px;border:2px solid var(--line);background:var(--surface-soft)">`
    : '<span class="dish-emoji">🍽️</span>';
  const tagText = f.tags.length ? f.tags.slice(0, 2).map((t) => '#' + esc(t)).join(' ') : '校园美食';
  return `<a class="card dish-card" href="#/food/${encodeURIComponent(f.key)}">
    ${cover}
    <span class="merchant-badge">${esc(f.shopName)}</span>
    <span class="title">${esc(f.dishName)}</span>
    <span class="stars">${starHtml(f.avg)} <b class="score-num">${f.avg.toFixed(1)}</b></span>
    <span class="meta"><span>${f.count} 人吃过</span><span class="price">${esc(tagText)}</span></span>
  </a>`;
}

/* ------------------------------ 页面：美食列表 ------------------------------ */

function renderFoods() {
  app.innerHTML = `
    <div class="section-head" style="margin-top:6px">
      <h2>全部美食</h2>
      <span class="sub">${state.foods.length} 道 · ${state.posts.length} 条测评</span>
    </div>
    <div class="chips">${tagChipsHtml(state.tag, state.hotTags)}</div>
    <div class="toolbar">
      <input id="searchInput" class="input" type="search" placeholder="搜索店名、菜名或标签" value="${esc(state.keyword)}">
      <select id="sortSelect" class="select">
        ${Object.keys(SORTS).map((k) => `<option value="${k}" ${state.sort === k ? 'selected' : ''}>${SORTS[k]}</option>`).join('')}
      </select>
    </div>
    <div id="foodList" class="dish-grid"></div>
  `;
  renderFoodList();
}

function renderFoodList() {
  const box = document.getElementById('foodList');
  if (!box) return;
  const list = filteredFoods();
  box.innerHTML = list.length
    ? list.map(foodCardHtml).join('')
    : '<div class="center-state tiny">还没有符合条件的美食，换个关键词试试，或者来上传一道吧</div>';
}

/* ------------------------------ 页面：美食详情 ------------------------------ */

function renderFoodDetail(key) {
  const f = foodOf(key);
  if (!f) {
    app.innerHTML = '<div class="center-state">没有找到这道美食。<br><a class="btn btn-ghost" href="#/dishes">返回美食列表</a></div>';
    return;
  }
  const uploadHref = `#/upload?shop=${encodeURIComponent(f.shopName)}&dish=${encodeURIComponent(f.dishName)}`;
  app.innerHTML = `
    <a class="back-link" href="#/dishes">← 返回美食列表</a>
    <section class="card detail-hero">
      <div class="detail-top">
        <div class="detail-emoji">🍽️</div>
        <div style="flex:1;min-width:0">
          <div class="merchant-badge">${esc(f.shopName)}</div>
          <div class="detail-title">${esc(f.dishName)}</div>
          <div class="row tiny muted" style="flex-wrap:wrap">${f.tags.map((t) => `<span>#${esc(t)}</span>`).join('') || '<span>校园美食</span>'}</div>
        </div>
      </div>
      ${f.cover ? `<img src="${esc(f.cover)}" alt="${esc(f.dishName)}" style="width:100%;max-height:300px;object-fit:cover;border-radius:14px;border:2px solid var(--line);margin-top:14px">` : ''}
      <div class="score-panel">
        <div><div class="score-big">${f.avg.toFixed(1)}<small>/ 5.0</small></div><div class="tiny muted stars">${starHtml(f.avg)}</div></div>
        <div class="score-stat">${f.count} 条公开测评<br>好评率 ${f.rate}%</div>
      </div>
      <div class="detail-cta">
        <a class="btn btn-primary" href="${uploadHref}">我也吃过，去测评</a>
        <a class="btn btn-ghost" href="#/dishes">看看别的</a>
      </div>
    </section>

    <div class="section-head"><h2>同学的真实测评</h2><span class="sub">共 ${f.posts.length} 条</span></div>
    <div id="postList">${f.posts.length ? f.posts.map(postCardHtml).join('') : '<div class="card center-state">还没有公开测评。</div>'}</div>
  `;
}

function postCardHtml(p) {
  const initial = p.is_anonymous ? '匿' : (p.nickname || '同').slice(0, 1);
  const name = p.is_anonymous ? '匿名用户' : (p.nickname || '同学');
  const images = Array.isArray(p.images) ? p.images : [];
  const tags = splitTags(p.tags);
  return `<article class="card review-item">
    <div class="review-head">
      <div class="avatar">${esc(initial)}</div>
      <div style="flex:1"><div class="review-name">${esc(name)}</div><div class="review-date">${fmtDate(p.created_at)}</div></div>
      <div class="stars">${starHtml(p.rating)}</div>
    </div>
    <p class="review-text">${esc(p.content)}</p>
    ${tags.length ? `<div class="row tiny muted" style="flex-wrap:wrap;margin-top:8px">${tags.map((t) => `<span>#${esc(t)}</span>`).join('')}</div>` : ''}
    ${images.length ? `<div class="review-photos">${images.map((src) => `<img src="${esc(src)}" alt="美食实拍图" loading="lazy">`).join('')}</div>` : ''}
  </article>`;
}

/* ------------------------------ 页面：上传美食 ------------------------------ */

function parseQuery() {
  const raw = location.hash.split('?')[1] || '';
  const out = {};
  raw.split('&').filter(Boolean).forEach((pair) => {
    const [k, v] = pair.split('=');
    out[decodeURIComponent(k)] = decodeURIComponent(v || '');
  });
  return out;
}

function renderUploadForm() {
  const q = parseQuery();
  state.form = {
    shopName: q.shop || '', dishName: q.dish || '', tags: '', rating: 0,
    text: '', anonymous: true, nickname: '', images: [],
  };
  app.innerHTML = `
    <a class="back-link" href="#/dishes">← 返回美食列表</a>
    <div class="notice">上传后不会立刻公开，需管理员审核通过才会显示给所有同学。请填写真实信息，不要上传他人隐私或不当内容。</div>
    <section class="card form-card">
      <label class="field">
        <span class="label">店名 / 摊位名（选填）</span>
        <input id="shopName" class="input" type="text" maxlength="60" placeholder="例如：食堂一楼 · 家常菜窗口；不填会自动显示为「未注明店名」" value="${esc(state.form.shopName)}">
      </label>
      <label class="field">
        <span class="label">菜品名称 <span style="color:var(--danger)">*</span></span>
        <input id="dishName" class="input" type="text" maxlength="60" placeholder="例如：红烧鸡腿饭" value="${esc(state.form.dishName)}">
      </label>
      <label class="field">
        <span class="label">标签（选填，用逗号隔开，最多 6 个）</span>
        <input id="tagInput" class="input" type="text" maxlength="100" placeholder="例如：下饭, 便宜, 速度快">
      </label>

      <label class="field">
        <span class="label">星级打分 <span style="color:var(--danger)">*</span></span>
        <div class="star-picker" id="starPicker">
          ${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-action="star" data-star="${n}" aria-label="${n}星">☆</button>`).join('')}
        </div>
        <div class="star-label" id="starLabel">点击星星打分</div>
      </label>

      <label class="field">
        <span class="label">说说这道菜 <span style="color:var(--danger)">*</span></span>
        <textarea id="reviewText" class="textarea" maxlength="1000" placeholder="味道怎么样？分量、价格、出餐速度如何？写得具体一点会帮到更多同学～"></textarea>
        <span class="tiny muted" id="textCount" style="display:block;text-align:right">0 / 1000（至少 5 个字）</span>
      </label>

      <div class="switch-row">
        <div><div style="font-weight:600">匿名上传</div><div class="tiny muted">开启后只显示“匿名用户”</div></div>
        <label class="switch"><input type="checkbox" id="anonSwitch" checked><span class="slider"></span></label>
      </div>
      <label class="field hidden" id="nicknameField">
        <span class="label">你的昵称</span>
        <input id="nickname" class="input" type="text" maxlength="20" placeholder="例如：三食堂常客">
      </label>

      <div class="field" style="margin-bottom:8px">
        <span class="label">上传美食实拍图（选填，最多 3 张）</span>
        <span class="tiny muted">仅支持 JPG / PNG / WEBP，会自动压缩后保存</span>
        <div class="upload-grid" id="uploadGrid"></div>
        <input type="file" id="imageInput" accept="image/jpeg,image/png,image/webp" multiple hidden>
      </div>

      <button class="btn btn-primary btn-block" data-action="submit-post" id="submitBtn" style="margin-top:18px">提交美食测评</button>
    </section>
  `;
  renderUploadGrid();
}

function renderUploadGrid() {
  const grid = document.getElementById('uploadGrid');
  if (!grid || !state.form) return;
  const tiles = state.form.images.map((src, i) =>
    `<div class="upload-tile"><img src="${esc(src)}" alt="待上传图片 ${i + 1}"><button class="remove" data-action="remove-image" data-index="${i}" aria-label="移除">×</button></div>`
  ).join('');
  const add = state.form.images.length < 3
    ? '<label class="upload-add" for="imageInput">＋<br>添加图片</label>'
    : '';
  grid.innerHTML = tiles + add;
}

async function compressImage(file) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = () => reject(new Error('图片读取失败'));
    reader.readAsDataURL(file);
  });
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const max = 1100;
      let w = img.width;
      let h = img.height;
      if (w > max || h > max) {
        const ratio = Math.min(max / w, max / h);
        w = Math.round(w * ratio);
        h = Math.round(h * ratio);
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', 0.7));
    };
    img.onerror = () => reject(new Error('图片解析失败'));
    img.src = dataUrl;
  });
}

async function submitPost() {
  const f = state.form;
  if (!f) return;
  const shop = ((document.getElementById('shopName') || {}).value || '').trim();
  const dish = ((document.getElementById('dishName') || {}).value || '').trim();
  const tags = ((document.getElementById('tagInput') || {}).value || '').trim();
  const text = (document.getElementById('reviewText') || {}).value || '';
  const nickname = (document.getElementById('nickname') || {}).value || '';
  if (!dish) return toast('请填写菜品名称');
  if (!f.rating) return toast('请先选择星级');
  if (text.trim().length < 5) return toast('测评内容至少写 5 个字');
  const btn = document.getElementById('submitBtn');
  btn.disabled = true;
  btn.textContent = '提交中…';
  try {
    // 不链式 .select()：新投稿是 pending，公开只读策略不允许回读它
    const submitted = await cloud.database.from('food_posts').insert({
      shop_name: shop,
      dish_name: dish,
      tags: splitTags(tags).join(','),
      rating: f.rating,
      content: text.trim(),
      images: f.images,
      is_anonymous: f.anonymous,
      nickname: f.anonymous ? '匿名用户' : (nickname.trim() || '同学'),
      status: 'pending',
    });
    if (submitted.error) throw submitted.error;
    app.innerHTML = `
      <div class="card login-card">
        <div style="font-size:44px">✅</div>
        <h2>提交成功</h2>
        <p class="muted">这份美食测评已进入审核队列，不会立刻对外展示。<br>管理员审核通过后，同学就能看到啦。</p>
        <div style="display:flex;gap:10px;margin-top:20px">
          <a class="btn btn-primary" style="flex:1" href="#/dishes">看看其他美食</a>
          <a class="btn btn-ghost" style="flex:1" href="#/home">回到首页</a>
        </div>
      </div>`;
    toast('提交成功，等待审核');
  } catch (err) {
    toast(err.message || '提交失败，请稍后重试');
    btn.disabled = false;
    btn.textContent = '提交美食测评';
  }
}

/* ------------------------------ 页面：管理后台 ------------------------------ */

function renderAdmin() {
  if (!state.admin.authed) {
    app.innerHTML = `
      <section class="card login-card">
        <div style="font-size:36px">🧺</div>
        <h2>管理员后台</h2>
        <p class="muted tiny">仅限校园项目管理员使用</p>
        <form id="adminLoginForm" style="margin-top:24px;text-align:left">
          <label class="field"><span class="label">管理密码</span><input class="input" id="adminCode" type="password" autocomplete="current-password" placeholder="请输入管理密码"></label>
          <button class="btn btn-primary btn-block" type="submit">进入后台</button>
        </form>
      </section>`;
    return;
  }

  const all = state.admin.posts;
  const counts = {
    pending: all.filter((p) => p.status === 'pending').length,
    approved: all.filter((p) => p.status === 'approved').length,
    rejected: all.filter((p) => p.status === 'rejected').length,
  };
  const list = state.admin.tab === 'all' ? all : all.filter((p) => p.status === state.admin.tab);

  app.innerHTML = `
    <div class="section-head" style="margin-top:6px"><h2>投稿审核</h2><button class="link-btn" data-action="admin-logout">退出登录</button></div>
    <div class="stat-grid">
      <div class="card stat-box"><b>${counts.pending}</b><span>待审核</span></div>
      <div class="card stat-box"><b>${counts.approved}</b><span>已通过</span></div>
      <div class="card stat-box"><b>${counts.rejected}</b><span>已驳回</span></div>
      <div class="card stat-box"><b>${all.length}</b><span>总投稿</span></div>
    </div>
    <div class="admin-tabs">
      ${[['pending', '待审核'], ['approved', '已通过'], ['rejected', '已驳回'], ['all', '全部']].map(([k, label]) =>
        `<button class="chip ${state.admin.tab === k ? 'active' : ''}" data-action="admin-tab" data-tab="${k}">${label}</button>`).join('')}
    </div>
    <div>
      ${list.length ? list.map(adminPostHtml).join('') : '<div class="card center-state tiny">这里暂时没有投稿</div>'}
    </div>

    <section class="card export-card">
      <h3>数据导出</h3>
      <p class="tiny muted">导出全部投稿（含待审核与已驳回），用于后续统计分析。仅管理员可导出。</p>
      <div class="export-row">
        <button class="btn" data-action="export-csv">导出 CSV</button>
        <button class="btn" data-action="export-json">导出 JSON</button>
      </div>
      <div style="border-top:1px solid var(--line);margin-top:18px;padding-top:14px">
        <div class="tiny" style="font-weight:600;margin-bottom:8px">修改管理密码</div>
        <div class="reject-box">
          <input class="input" id="oldCode" type="password" placeholder="原密码">
          <input class="input" id="newCode" type="password" placeholder="新密码（至少 6 位）">
          <button class="btn btn-sm" data-action="change-code">修改</button>
        </div>
      </div>
    </section>
  `;
}

function adminPostHtml(p) {
  const statusText = { pending: '待审核', approved: '已通过', rejected: '已驳回' }[p.status] || p.status;
  const images = Array.isArray(p.images) ? p.images : [];
  const tags = splitTags(p.tags);
  return `<article class="card admin-review">
    <div class="spread">
      <div style="min-width:0">
        <div class="tiny muted">${esc(p.shop_name || '未注明店名')} · ${esc(p.dish_name)}</div>
        <div style="font-weight:600">${esc(p.is_anonymous ? '匿名用户' : (p.nickname || '同学'))} <span class="stars">${starHtml(p.rating)}</span></div>
      </div>
      <span class="status-pill ${esc(p.status)}">${statusText}</span>
    </div>
    ${tags.length ? `<div class="row tiny muted" style="flex-wrap:wrap;margin-top:6px">${tags.map((t) => `<span>#${esc(t)}</span>`).join('')}</div>` : ''}
    <p class="review-text">${esc(p.content)}</p>
    ${images.length ? `<div class="review-photos">${images.map((src) => `<img src="${esc(src)}" alt="美食实拍图">`).join('')}</div>` : ''}
    <div class="tiny muted" style="margin-top:8px">提交于 ${fmtDate(p.created_at)}${p.reject_reason ? ' · 驳回原因：' + esc(p.reject_reason) : ''}</div>
    ${p.status === 'pending' ? `
      <div class="admin-actions">
        <button class="btn btn-primary btn-sm" data-action="approve" data-id="${p.id}">通过</button>
        <button class="btn btn-danger btn-sm" data-action="reject-start" data-id="${p.id}">驳回</button>
      </div>
      ${state.admin.rejecting === p.id ? `<div class="reject-box"><input class="input" id="rejectReason" maxlength="100" placeholder="填写驳回原因（选填）"><button class="btn btn-sm btn-danger" data-action="reject-confirm" data-id="${p.id}">确认驳回</button></div>` : ''}
    ` : `<div class="admin-actions"><button class="btn btn-ghost btn-sm" data-action="toggle-status" data-id="${p.id}" data-status="${p.status === 'approved' ? 'rejected' : 'approved'}">${p.status === 'approved' ? '改为驳回' : '改为通过'}</button></div>`}
  </article>`;
}

async function refreshAdminPosts() {
  state.admin.posts = unwrap(await cloud.database.rpc('admin_list_posts', { p_passcode: state.admin.code }).select('*')) || [];
}

async function setPostStatus(id, status, reason = '') {
  await unwrap(cloud.database.rpc('admin_set_post_status', {
    p_passcode: state.admin.code,
    p_id: Number(id),
    p_status: status,
    p_reason: reason,
  }));
  state.admin.rejecting = null;
  await refreshAdminPosts();
  state.loaded = false;
  renderAdmin();
  toast(status === 'approved' ? '已通过，投稿已公开显示' : '已驳回');
}

function downloadFile(name, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function toCsv(rows) {
  const headers = ['投稿ID', '店名', '菜名', '标签', '星级', '测评内容', '是否匿名', '昵称', '图片数', '状态', '驳回原因', '提交时间', '审核时间'];
  const keys = ['post_id', 'shop_name', 'dish_name', 'tags', 'rating', 'content', 'is_anonymous', 'nickname', 'image_count', 'status', 'reject_reason', 'created_at', 'reviewed_at'];
  const quote = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  return '\ufeff' + [headers.map(quote).join(','), ...rows.map((r) => keys.map((k) => quote(r[k])).join(','))].join('\r\n');
}

async function exportData(format) {
  try {
    const rows = unwrap(await cloud.database.rpc('admin_export_posts', { p_passcode: state.admin.code })) || [];
    const day = new Date().toISOString().slice(0, 10);
    if (format === 'csv') downloadFile(`校园食评_投稿数据_${day}.csv`, toCsv(rows), 'text/csv;charset=utf-8');
    else downloadFile(`校园食评_投稿数据_${day}.json`, JSON.stringify(rows, null, 2), 'application/json;charset=utf-8');
    toast(`已导出 ${rows.length} 条投稿`);
  } catch (err) {
    toast(err.message || '导出失败');
  }
}

/* ------------------------------ 路由 ------------------------------ */

function currentParts() {
  const raw = location.hash.replace(/^#\/?/, '');
  return raw.split('?')[0].split('/').filter(Boolean);
}

function syncNav(key) {
  const active = key === 'food' ? 'dishes' : key === 'upload' ? 'upload' : key;
  document.querySelectorAll('[data-nav], [data-tab]').forEach((el) => {
    el.classList.toggle('active', (el.dataset.nav || el.dataset.tab) === active);
  });
}

async function route() {
  const parts = currentParts();
  const key = parts[0] || 'home';
  syncNav(key);
  try {
    await loadData();
    if (key === 'home') renderHome();
    else if (key === 'dishes') renderFoods();
    else if (key === 'food') renderFoodDetail(decodeURIComponent(parts.slice(1).join('/')));
    else if (key === 'upload') renderUploadForm();
    else if (key === 'admin') renderAdmin();
    else renderHome();
  } catch (err) {
    app.innerHTML = `<div class="center-state"><span class="loading-emoji">🍽️</span>加载失败：${esc(err.message || '请稍后重试')}<br><button class="btn btn-ghost" data-action="retry">重新加载</button></div>`;
  }
}

/* ------------------------------ 事件 ------------------------------ */

app.addEventListener('click', async (e) => {
  const target = e.target.closest('[data-action]');
  if (!target) return;
  const { action } = target.dataset;

  if (action === 'tag') {
    state.tag = target.dataset.tag;
    if (currentParts()[0] === 'dishes') renderFoods();
    else route();
  } else if (action === 'star') {
    const n = Number(target.dataset.star);
    state.form.rating = n;
    document.querySelectorAll('#starPicker button').forEach((b) => {
      const on = Number(b.dataset.star) <= n;
      b.classList.toggle('on', on);
      b.textContent = on ? '★' : '☆';
    });
    document.getElementById('starLabel').textContent = `${n} 星 · ${RATING_LABELS[n]}`;
  } else if (action === 'remove-image') {
    state.form.images.splice(Number(target.dataset.index), 1);
    renderUploadGrid();
  } else if (action === 'submit-post') {
    await submitPost();
  } else if (action === 'retry') {
    state.loaded = false;
    route();
  } else if (action === 'admin-logout') {
    state.admin.authed = false;
    state.admin.code = '';
    state.admin.posts = [];
    renderAdmin();
  } else if (action === 'admin-tab') {
    state.admin.tab = target.dataset.tab;
    state.admin.rejecting = null;
    renderAdmin();
  } else if (action === 'approve') {
    await setPostStatus(target.dataset.id, 'approved');
  } else if (action === 'reject-start') {
    state.admin.rejecting = Number(target.dataset.id);
    renderAdmin();
    const input = document.getElementById('rejectReason');
    if (input) input.focus();
  } else if (action === 'reject-confirm') {
    const reason = (document.getElementById('rejectReason') || {}).value || '';
    await setPostStatus(target.dataset.id, 'rejected', reason.trim());
  } else if (action === 'toggle-status') {
    await setPostStatus(target.dataset.id, target.dataset.status);
  } else if (action === 'export-csv') {
    await exportData('csv');
  } else if (action === 'export-json') {
    await exportData('json');
  } else if (action === 'change-code') {
    const oldCode = (document.getElementById('oldCode') || {}).value || '';
    const newCode = (document.getElementById('newCode') || {}).value || '';
    if (newCode.length < 6) return toast('新密码至少 6 位');
    try {
      await unwrap(cloud.database.rpc('admin_change_passcode', { p_old: oldCode, p_new: newCode }));
      state.admin.code = newCode;
      toast('管理密码已修改');
      renderAdmin();
    } catch (err) {
      toast(err.message === 'INVALID_PASSCODE' ? '原密码不正确' : '修改失败，请重试');
    }
  }
});

app.addEventListener('input', (e) => {
  if (e.target.id === 'searchInput') {
    state.keyword = e.target.value;
    renderFoodList();
  } else if (e.target.id === 'reviewText') {
    state.form.text = e.target.value;
    const count = document.getElementById('textCount');
    if (count) count.textContent = `${e.target.value.length} / 1000（至少 5 个字）`;
  } else if (e.target.id === 'nickname') {
    state.form.nickname = e.target.value;
  } else if (e.target.id === 'tagInput') {
    state.form.tags = e.target.value;
  } else if (e.target.id === 'shopName') {
    state.form.shopName = e.target.value;
  } else if (e.target.id === 'dishName') {
    state.form.dishName = e.target.value;
  } else if (e.target.id === 'anonSwitch') {
    state.form.anonymous = e.target.checked;
    const field = document.getElementById('nicknameField');
    if (field) field.classList.toggle('hidden', e.target.checked);
  }
});

app.addEventListener('change', async (e) => {
  if (e.target.id === 'sortSelect') {
    state.sort = e.target.value;
    renderFoodList();
  } else if (e.target.id === 'imageInput') {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!state.form) return;
    const room = 3 - state.form.images.length;
    if (room <= 0) return toast('最多上传 3 张图片');
    const picked = files.slice(0, room);
    const invalid = picked.filter((f) => !f.type.startsWith('image/') || f.size > 8 * 1024 * 1024);
    if (invalid.length) toast('已跳过不支持或超过 8MB 的图片');
    for (const file of picked.filter((f) => f.type.startsWith('image/') && f.size <= 8 * 1024 * 1024)) {
      try {
        state.form.images.push(await compressImage(file));
      } catch (err) {
        toast('有图片处理失败，请重试');
      }
    }
    renderUploadGrid();
  }
});

app.addEventListener('submit', async (e) => {
  if (e.target.id !== 'adminLoginForm') return;
  e.preventDefault();
  const code = (document.getElementById('adminCode') || {}).value || '';
  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true;
  btn.textContent = '验证中…';
  try {
    const ok = unwrap(await cloud.database.rpc('admin_check', { p_passcode: code }));
    if (!ok) throw new Error('管理密码不正确');
    state.admin.code = code;
    state.admin.authed = true;
    await refreshAdminPosts();
    renderAdmin();
  } catch (err) {
    toast(err.message === 'INVALID_PASSCODE' ? '管理密码不正确' : (err.message || '验证失败'));
    btn.disabled = false;
    btn.textContent = '进入后台';
  }
});

app.addEventListener('click', (e) => {
  const img = e.target.closest('.review-photos img, .detail-hero img');
  if (img) {
    document.getElementById('imageModalImg').src = img.src;
    modal.classList.remove('hidden');
  }
});

document.addEventListener('click', (e) => {
  if (e.target.closest('[data-action="close-modal"]') || e.target === modal) {
    modal.classList.add('hidden');
    document.getElementById('imageModalImg').src = '';
  }
});

window.addEventListener('hashchange', route);

if (!location.hash) location.replace('#/home');
route();
