// app.js – 화면 동작 (목록 그리기, 일정 추가)

// 01 단원 : 일정 목록을 코드 안에 둠 (가상 데이터) → 04 단원에서 data/tasks.json 으로 분리
const SAMPLE_TASKS = [
  { title: '다중이용시설 안전점검', region: '세종', kind: '야외', owner: '김안전' },
  { title: '시민 안전체험 행사 운영', region: '보령', kind: '야외', owner: '이행사' },
  { title: '옥상 태양광 설비 점검', region: '태안', kind: '고소', owner: '박설비' },
  { title: '하천 수위계 확인', region: '대전', kind: '야외', owner: '최현장' },
  { title: '청사 외벽 간판 보수', region: '세종', kind: '고소', owner: '정시설' },
  { title: '비상연락 훈련', region: '대전', kind: '실내', owner: '한상황' },
];

let tasks = [];
let weatherByRegion = {};
const windTest = new URLSearchParams(window.location.search).get('test') === 'wind';

function loadTasks() {
  const saved = JSON.parse(localStorage.getItem('wx_added') || '[]');
  tasks = SAMPLE_TASKS.concat(saved);
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
  const t = {
    title: document.getElementById('titleInput').value.trim(),
    region: document.getElementById('regionInput').value,
    kind: document.getElementById('kindInput').value,
    owner: document.getElementById('ownerInput').value.trim(),
  };
  if (!t.title || !t.owner) return;
  const saved = JSON.parse(localStorage.getItem('wx_added') || '[]');
  saved.push(t);
  localStorage.setItem('wx_added', JSON.stringify(saved));
  e.target.reset();
  loadTasks();
  renderTasks();
}

document.getElementById('taskForm').addEventListener('submit', addTask);
loadTasks();
renderTasks();
loadWeather();
