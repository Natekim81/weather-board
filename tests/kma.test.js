const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {
  kmaForecastPeriod, buildKmaUrl, parseKmaResponse, judge, KMA_GRIDS,
} = require('../logic.js');
const { createHandler } = require('../api/kma.js');

const date = '2026-10-27';
const secretFixture = 'test-only-key+/=';
const config = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_PUBLIC_KEY: 'sb_publishable_test_only' };
const rows = ['야외', '고소', '실내'].map((kind, index) => ({
  id: index + 1, title: '가상 일정 ' + index, region: '대전', kind, owner: '가상담당',
}));

function forecast({ temp = 25, wind = 3, rain = 20 } = {}) {
  const item = [];
  for (let hour = 0; hour < 24; hour++) {
    for (const [category, value] of [['TMP', temp], ['WSD', wind], ['POP', rain]]) {
      item.push({ category, fcstDate: '20261027', fcstTime: String(hour).padStart(2, '0') + '00', fcstValue: String(value) });
    }
  }
  return { response: { header: { resultCode: '00' }, body: { items: { item } } } };
}

function response(data, { ok = true, range } = {}) {
  return { ok, headers: new Headers(range ? { 'content-range': range } : {}), json: async () => data };
}

async function call(options = {}) {
  const calls = [];
  const handler = createHandler({
    config: options.config || config,
    clock: () => new Date('2026-10-27T01:00:00Z'),
    getKmaKey: () => options.noKey ? '' : secretFixture,
    fetchImpl: async (rawUrl, init) => {
      const url = new URL(rawUrl);
      calls.push({ url, init });
      assert.equal(init.redirect, 'error');
      assert.ok(init.signal instanceof AbortSignal);
      if (url.hostname === 'example.supabase.co') {
        assert.equal(url.pathname, '/rest/v1/wx_tasks');
        assert.equal(url.searchParams.get('region'), 'eq.' + (options.region || '대전'));
        assert.equal(init.headers.apikey, config.SUPABASE_PUBLIC_KEY);
        if (options.dbFailure) throw new Error('DB diagnostic ' + secretFixture);
        if (options.dbHttp) return response({}, { ok: false });
        if (options.dbInvalid) return response({ error: 'bad' });
        const all = options.rows || rows;
        if (options.pageSize) {
          const offset = Number(url.searchParams.get('offset'));
          const page = all.slice(offset, offset + options.pageSize);
          return response(page, { range: offset + '-' + (offset + page.length - 1) + '/' + all.length });
        }
        return response(all);
      }
      assert.equal(url.origin, 'https://apis.data.go.kr');
      assert.equal(url.searchParams.get('serviceKey'), secretFixture);
      assert.equal(url.searchParams.get('base_date'), '20261026');
      assert.equal(url.searchParams.get('base_time'), '2300');
      if (options.kmaFailure) throw new Error('KMA diagnostic ' + rawUrl);
      if (options.kmaHttp) return response({}, { ok: false });
      if (options.kmaBadJson) return { ok: true, json: async () => { throw new Error(rawUrl); } };
      return response(options.forecast || forecast());
    },
  });
  const result = { headers: {} };
  const res = {
    setHeader: (key, value) => { result.headers[key.toLowerCase()] = value; },
    status: code => { result.status = code; return res; },
    json: body => { result.body = body; return res; },
  };
  await handler({ method: options.method || 'GET', url: options.url || '/api/kma?region=' + encodeURIComponent(options.region || '대전') }, res);
  assert.ok(!JSON.stringify(result).includes(secretFixture), 'response must not expose key');
  return { ...result, calls };
}

test('한국 자정·월말·연말에도 오늘 날짜와 전날 23시를 고른다', () => {
  assert.deepEqual(kmaForecastPeriod(new Date('2026-10-27T14:59:59Z')), { date, baseDate: '20261026', baseTime: '2300' });
  assert.deepEqual(kmaForecastPeriod(new Date('2026-10-27T15:00:00Z')), { date: '2026-10-28', baseDate: '20261027', baseTime: '2300' });
  assert.equal(kmaForecastPeriod(new Date('2026-12-31T15:00:00Z')).baseDate, '20261231');
  assert.equal(kmaForecastPeriod(new Date('2026-02-28T15:00:00Z')).baseDate, '20260228');
});

test('4개 지역 격자와 원본·인코딩 키를 정확히 요청한다', () => {
  const period = kmaForecastPeriod(new Date('2026-10-27T01:00:00Z'));
  for (const region of Object.keys(KMA_GRIDS)) {
    for (const key of [secretFixture, encodeURIComponent(secretFixture)]) {
      const url = new URL(buildKmaUrl(region, key, period));
      assert.equal(url.searchParams.get('serviceKey'), secretFixture);
      assert.equal(url.searchParams.get('nx'), String(KMA_GRIDS[region].nx));
      assert.equal(url.searchParams.get('ny'), String(KMA_GRIDS[region].ny));
      assert.equal(url.searchParams.get('dataType'), 'JSON');
    }
  }
  assert.throws(() => buildKmaUrl('서울', secretFixture, period));
  assert.throws(() => buildKmaUrl('대전', '', period));
});

test('오늘만 골라 기온·풍속·강수확률의 하루 최댓값을 계산한다', () => {
  const data = forecast();
  data.response.body.items.item.push(
    { category: 'TMX', fcstDate: '20261027', fcstTime: '1500', fcstValue: '33' },
    { category: 'WSD', fcstDate: '20261027', fcstTime: '2300', fcstValue: '12' },
    { category: 'POP', fcstDate: '20261027', fcstTime: '0000', fcstValue: '60' },
    { category: 'TMP', fcstDate: '20261028', fcstTime: '1500', fcstValue: '50' },
  );
  assert.deepEqual(parseKmaResponse(data, date), { tempMax: 33, windMax: 12, rainProb: 60 });
  assert.deepEqual(parseKmaResponse(forecast({ temp: -5, wind: 0, rain: 0 }), date), { tempMax: -5, windMax: 0, rainProb: 0 });
});

test('실패 응답·24시간 누락·빈 값·결측값을 정상 날씨로 해석하지 않는다', () => {
  for (const data of [null, {}, { response: { header: { resultCode: '30' } } }, forecast()]) {
    if (data && data.response && data.response.body) data.response.body.items.item.shift();
    assert.throws(() => parseKmaResponse(data, date));
  }
  for (const value of ['', null, '-999', 'NaN']) {
    const data = forecast();
    data.response.body.items.item[0].fcstValue = value;
    assert.throws(() => parseKmaResponse(data, date));
  }
  assert.throws(() => parseKmaResponse(forecast({ rain: 101 }), date));
  assert.throws(() => parseKmaResponse(forecast({ wind: -1 }), date));
});

test('DB 일정·날씨·판단을 반환하고 규칙 경계와 우선순위를 지킨다', async () => {
  const result = await call({ forecast: forecast({ temp: 33, wind: 10, rain: 60 }) });
  assert.equal(result.status, 200);
  assert.equal(result.body.region, '대전');
  assert.deepEqual(result.body.tasks.map(t => t.title), rows.map(t => t.title));
  assert.deepEqual(result.body.tasks.map(t => t.judgment.text), ['폭염 휴식', '중지 검토', '영향 없음']);
  assert.deepEqual(result.body.units, { tempMax: '℃', windMax: 'm/s', rainProb: '%' });
  assert.equal(result.body.warning, null);
  assert.equal(result.headers['cache-control'], 'no-store');
  assert.equal(judge('야외', { tempMax: 32.9, windMax: 10, rainProb: 60 }).text, '우천 주의');
  assert.equal(judge('고소', { tempMax: 32.9, windMax: 9.9, rainProb: 59.9 }).text, '진행');
});

test('4개 지역 조회와 일정 없는 지역을 지원한다', async () => {
  for (const region of Object.keys(KMA_GRIDS)) {
    const result = await call({ region, rows: rows.map(t => ({ ...t, region })) });
    assert.equal(result.status, 200);
    assert.ok(result.body.tasks.every(t => t.region === region));
  }
  assert.deepEqual((await call({ rows: [] })).body.tasks, []);
});

test('DB 페이지 제한이 작아도 모든 지역 일정을 읽는다', async () => {
  const result = await call({ pageSize: 1 });
  assert.equal(result.body.tasks.length, 3);
  assert.equal(result.calls.filter(c => c.url.hostname === 'example.supabase.co').length, 3);
});

test('지역 오류·중복·메서드 오류를 외부 호출 전에 거부한다', async () => {
  for (const url of ['/api/kma', '/api/kma?region=', '/api/kma?region=서울', '/api/kma?region=__proto__', '/api/kma?region=대전&region=세종']) {
    const result = await call({ url });
    assert.equal(result.status, 400);
    assert.equal(result.calls.length, 0);
  }
  const result = await call({ method: 'POST' });
  assert.equal(result.status, 405);
  assert.equal(result.headers.allow, 'GET');
  assert.equal(result.calls.length, 0);
});

test('비밀 DB 키·설정 오류와 DB 장애는 오류 상태로 반환한다', async () => {
  for (const bad of [{}, { SUPABASE_URL: '', SUPABASE_PUBLIC_KEY: config.SUPABASE_PUBLIC_KEY },
    { ...config, SUPABASE_PUBLIC_KEY: 'sb_secret_test_only' }]) {
    const result = await call({ config: bad });
    assert.equal(result.status, 503);
    assert.equal(result.calls.length, 0);
  }
  for (const option of ['dbFailure', 'dbHttp', 'dbInvalid']) {
    const result = await call({ [option]: true });
    assert.equal(result.status, 502);
    assert.equal(result.body.error.code, 'DB_UNAVAILABLE');
    assert.equal(result.calls.length, 1);
  }
});

test('키 누락·HTTP·JSON·예보 오류에도 일정과 실내 판단을 유지한다', async () => {
  for (const option of ['noKey', 'kmaFailure', 'kmaHttp', 'kmaBadJson']) {
    const result = await call({ [option]: true });
    assert.equal(result.status, 200);
    assert.equal(result.body.weather, null);
    assert.deepEqual(result.body.tasks.map(t => t.judgment.text), ['날씨 확인 전', '날씨 확인 전', '영향 없음']);
    assert.equal(result.body.warning.code, option === 'noKey' ? 'KMA_KEY_MISSING' : 'WEATHER_UNAVAILABLE');
  }
  const incomplete = forecast();
  incomplete.response.body.items.item.pop();
  assert.equal((await call({ forecast: incomplete })).body.weather, null);
});

test('두 줄 config와 기존 화면의 일정·날씨·Markdown 저장이 함께 동작한다', async () => {
  const root = path.join(__dirname, '..');
  const source = fs.readFileSync(path.join(root, 'config.js'), 'utf8');
  assert.equal(source.trim().split(/\r?\n/).length, 2);
  const serverConfig = require('../config.js');
  class Element {
    constructor() { this.children = []; this.textContent = ''; this.listeners = {}; }
    set innerHTML(value) { assert.equal(value, ''); this.children = []; }
    get rows() { return this.children; }
    get cells() { return this.children; }
    appendChild(element) { this.children.push(element); }
    addEventListener(name, listener) { this.listeners[name] = listener; }
    click() { this.clicked = true; }
    remove() {}
  }
  const elements = Object.fromEntries(['taskList', 'taskForm', 'msgBox', 'weatherBox', 'saveMarkdownButton', 'addTaskButton',
    'titleInput', 'ownerInput', 'regionInput', 'kindInput'].map(id => [id, new Element()]));
  let blob, anchor, inserted;
  const context = {
    atob, URLSearchParams, AbortController, Blob, setTimeout, clearTimeout,
    URL: { createObjectURL(value) { blob = value; return 'blob:test'; }, revokeObjectURL() {} },
    window: { location: { search: '?test=wind' }, supabase: { createClient(url, key) {
      assert.equal(url, serverConfig.SUPABASE_URL);
      assert.equal(key, serverConfig.SUPABASE_PUBLIC_KEY);
      return { from() { return {
        select: () => ({ order: async () => ({ data: rows.map(t => ({ ...t })), error: null }) }),
        insert: task => { inserted = task; return { select: () => ({ single: async () => ({ data: { id: 4, ...task }, error: null }) }) }; },
      }; } };
    } } },
    document: { body: new Element(), getElementById: id => elements[id], createElement(type) {
      const element = new Element(); if (type === 'a') anchor = element; return element;
    } },
    fetch: async () => { throw new Error('weather unavailable'); },
  };
  vm.createContext(context);
  for (const filename of ['logic.js', 'config.js', 'app.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, filename), 'utf8'), context);
  }
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(elements.taskList.children.length, 3);
  assert.equal(elements.taskList.children[1].children[5].textContent, '중지 검토');
  elements.titleInput.value = '<img src=x>|가상 일정';
  elements.ownerInput.value = '가상담당';
  elements.regionInput.value = '대전';
  elements.kindInput.value = '실내';
  let reset = false;
  await elements.taskForm.listeners.submit({ preventDefault() {}, target: { reset() { reset = true; } } });
  assert.ok(reset);
  assert.equal(inserted.title, '<img src=x>|가상 일정');
  assert.equal(elements.taskList.children.length, 4);
  elements.saveMarkdownButton.listeners.click();
  const markdown = await blob.text();
  assert.ok(anchor.clicked);
  assert.match(anchor.download, /^현장일정_판단_\d{4}-\d{2}-\d{2}\.md$/);
  assert.ok(markdown.includes('시험값'));
  assert.ok(markdown.includes('&lt;img src=x&gt;\\|가상 일정'));
});
