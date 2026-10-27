// app.js – 화면 동작 (목록 그리기, 일정 추가)

// 일정은 Supabase wx_tasks에서만 읽고 저장한다.
let tasks = [];
let tasksReady = false;
let taskSaving = false;
let dbClient = null;
const TASK_COLUMNS = 'id,title,region,kind,owner';
let weatherByRegion = {};
const windTest = new URLSearchParams(window.location.search).get('test') === 'wind';

function isTaskList(value) {
  return Array.isArray(value) && value.every(t => t &&
    ['title', 'region', 'kind', 'owner'].every(key => typeof t[key] === 'string' && t[key].trim()) &&
    Object.hasOwn(REGIONS, t.region) && ['야외', '고소', '실내'].includes(t.kind));
}

async function loadTasks() {
  const msg = document.getElementById('msgBox');
  const button = document.getElementById('addTaskButton');
  tasksReady = false;
  button.disabled = true;
  msg.textContent = '일정 불러오는 중';
  try {
    if (typeof SUPABASE_URL !== 'string' || !/^https:\/\//.test(SUPABASE_URL) ||
        typeof SUPABASE_PUBLIC_KEY !== 'string' || !isPublicSupabaseKey(SUPABASE_PUBLIC_KEY)) {
      msg.textContent = 'config.js에 Supabase 주소와 공개용 키(publishable 또는 anon)를 입력해 주세요.';
      return;
    }
    if (!window.supabase || typeof window.supabase.createClient !== 'function') {
      msg.textContent = 'Supabase 스크립트를 읽지 못했습니다. 인터넷 연결을 확인하고 새로고침해 주세요.';
      return;
    }
    if (!dbClient) dbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLIC_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data, error } = await dbClient.from('wx_tasks').select(TASK_COLUMNS).order('id', { ascending: true });
    if (error) throw error;
    if (!isTaskList(data)) throw new Error('일정 응답 형식 오류');
    tasks = data;
    tasksReady = true;
    button.disabled = false;
    msg.textContent = tasks.length ? '' : '등록된 일정이 없습니다.';
  } catch (error) {
    msg.textContent = 'Supabase 일정을 읽지 못했습니다. config.js, setup.sql 실행 여부와 인터넷 연결을 확인한 뒤 새로고침해 주세요.';
  } finally {
    renderTasks();
  }
}

function isPublicSupabaseKey(key) {
  if (key.startsWith('sb_publishable_')) return true;
  // 기존 anon JWT도 지원하되 service_role 등의 키는 클라이언트를 만들기 전에 거부한다.
  try {
    const payload = key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(payload)).role === 'anon';
  } catch (error) {
    return false;
  }
}

function weatherText(w) {
  if (!w) return '-';
  const value = (n, unit) => Number.isFinite(n) ? n + unit : '미수신';
  return '최고 ' + value(w.tempMax, '℃') + ' · 최대 ' + value(w.windMax, ' m/s') +
    ' · 강수확률 ' + value(w.rainProb, '%');
}

async function loadWeather() {
  const box = document.getElementById('weatherBox');
  const failed = [];
  let completed = 0;
  const regions = Object.keys(REGIONS);
  const testNotice = windTest ? ' · 강풍 시험 모드: 모든 지역 풍속 12 m/s (시험값)' : '';
  box.textContent = '오늘 날씨 불러오는 중 (한국 시간 기준)' + testNotice;

  await Promise.all(regions.map(async (region) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(buildWeatherUrl(region), { signal: controller.signal });
      if (!response.ok) throw new Error('날씨 API 요청 실패');
      const weather = parseWeatherResponse(await response.json());
      weatherByRegion[region] = applyWindTest(weather, windTest);
    } catch (error) {
      failed.push(region);
      weatherByRegion[region] = applyWindTest(null, windTest);
    } finally {
      clearTimeout(timeout);
      completed += 1;
      renderTasks();
      const progress = completed < regions.length
        ? '오늘 날씨 불러오는 중 (' + completed + '/' + regions.length + ')'
        : '오늘 날씨 수신: ' + (regions.length - failed.length) + '/' + regions.length + '개 지역';
      const failure = failed.length ? ' · 수신 실패: ' + failed.join(', ') + ' (새로고침해 다시 시도)' : '';
      box.textContent = progress + ' · 한국 시간 기준 일별 최댓값' + failure + testNotice;
    }
  }));
}

function renderTasks() {
  const body = document.getElementById('taskList');
  body.innerHTML = '';
  for (const t of tasks) {
    const w = weatherByRegion[t.region];
    const r = judge(t.kind, w);
    const tr = document.createElement('tr');
    for (const v of [t.title, t.region, t.kind, t.owner, weatherText(w)]) {
      const td = document.createElement('td');
      td.textContent = v;
      tr.appendChild(td);
    }
    const td = document.createElement('td');
    td.textContent = r.text;
    td.className = r.level;
    tr.appendChild(td);
    body.appendChild(tr);
  }
}

function downloadJudgment() {
  const date = koreanDate();
  const rows = Array.from(document.getElementById('taskList').rows,
    row => Array.from(row.cells, cell => cell.textContent));
  const markdown = buildJudgmentMarkdown(rows, date, windTest);
  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = '현장일정_판단_' + date + '.md';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function addTask(e) {
  e.preventDefault();
  if (!tasksReady || taskSaving) return;
  const t = {
    title: document.getElementById('titleInput').value.trim(),
    region: document.getElementById('regionInput').value,
    kind: document.getElementById('kindInput').value,
    owner: document.getElementById('ownerInput').value.trim(),
  };
  if (!isTaskList([t])) return;
  const msg = document.getElementById('msgBox');
  const button = document.getElementById('addTaskButton');
  taskSaving = true;
  button.disabled = true;
  msg.textContent = '일정 저장 중';
  try {
    const { data, error } = await dbClient.from('wx_tasks').insert(t).select(TASK_COLUMNS).single();
    if (error) throw error;
    if (!data || !isTaskList([data])) throw new Error('저장 응답 형식 오류');
    tasks.push(data);
    e.target.reset();
    renderTasks();
    msg.textContent = '일정을 저장했습니다.';
  } catch (error) {
    msg.textContent = '일정 저장을 확인하지 못했습니다. 입력은 유지했습니다. 새로고침해 저장 여부를 확인해 주세요.';
  } finally {
    taskSaving = false;
    button.disabled = false;
  }
}

document.getElementById('taskForm').addEventListener('submit', addTask);
document.getElementById('saveMarkdownButton').addEventListener('click', downloadJudgment);
loadTasks();
renderTasks();
loadWeather();
