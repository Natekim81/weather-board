// app.js – 화면 동작 (목록 그리기, 일정 추가)

// 기본 일정은 JSON, 화면에서 추가한 일정만 localStorage에 보관한다.
let baseTasks = [];
let addedTasks = [];
let tasks = [];
let tasksReady = false;
let weatherByRegion = {};
const windTest = new URLSearchParams(window.location.search).get('test') === 'wind';

function isTaskList(value) {
  return Array.isArray(value) && value.every(t => t &&
    ['title', 'region', 'kind', 'owner'].every(key => typeof t[key] === 'string' && t[key].trim()) &&
    Object.hasOwn(REGIONS, t.region) && ['야외', '고소', '실내'].includes(t.kind));
}

async function loadTasks() {
  const msg = document.getElementById('msgBox');
  msg.textContent = '일정 불러오는 중';
  try {
    const response = await fetch('data/tasks.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('일정 파일 요청 실패');
    const data = await response.json();
    if (!isTaskList(data)) throw new Error('일정 파일 형식 오류');
    baseTasks = data;
    msg.textContent = '';
  } catch (error) {
    msg.textContent = window.location.protocol === 'file:'
      ? '배포 주소로 열어 주세요'
      : '일정 파일을 읽지 못했습니다. 새로고침해 다시 시도해 주세요.';
  }

  // JSON 요청이 끝난 후 브라우저에 저장된 추가 일정만 읽는다.
  try {
    const saved = JSON.parse(localStorage.getItem('wx_added') || '[]');
    if (!isTaskList(saved)) throw new Error('저장된 일정 형식 오류');
    addedTasks = saved;
  } catch (error) {
    msg.textContent += (msg.textContent ? ' · ' : '') + '브라우저에 저장된 추가 일정을 읽지 못했습니다.';
  }
  tasks = baseTasks.concat(addedTasks);
  tasksReady = true;
  renderTasks();
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

function addTask(e) {
  e.preventDefault();
  if (!tasksReady) return;
  const t = {
    title: document.getElementById('titleInput').value.trim(),
    region: document.getElementById('regionInput').value,
    kind: document.getElementById('kindInput').value,
    owner: document.getElementById('ownerInput').value.trim(),
  };
  if (!t.title || !t.owner) return;
  const saved = addedTasks.concat(t);
  try {
    localStorage.setItem('wx_added', JSON.stringify(saved));
  } catch (error) {
    const msg = document.getElementById('msgBox');
    msg.textContent += (msg.textContent ? ' · ' : '') + '일정을 브라우저에 저장하지 못했습니다.';
    return;
  }
  addedTasks = saved;
  tasks = baseTasks.concat(addedTasks);
  e.target.reset();
  renderTasks();
}

document.getElementById('taskForm').addEventListener('submit', addTask);
loadTasks();
renderTasks();
loadWeather();
