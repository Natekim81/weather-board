// Vercel Node.js Function. KMA_KEY는 이 서버에서만 사용한다.
const settings = require('../config.js');
const {
  REGIONS, judge, isPublicSupabaseKey, kmaForecastPeriod, buildKmaUrl, parseKmaResponse,
} = require('../logic.js');

function createHandler({ fetchImpl = fetch, config = settings,
  getKmaKey = () => process.env.KMA_KEY, clock = () => new Date() } = {}) {
  async function request(url, headers = {}) {
    const response = await fetchImpl(url, {
      headers, signal: AbortSignal.timeout(8000), redirect: 'error',
    });
    if (!response.ok) throw new Error('외부 서비스 조회 실패');
    return { data: await response.json(), headers: response.headers };
  }

  async function readTasks(region) {
    const url = new URL('/rest/v1/wx_tasks', config.SUPABASE_URL);
    url.searchParams.set('select', 'id,title,region,kind,owner');
    url.searchParams.set('region', 'eq.' + region);
    url.searchParams.set('order', 'id.asc');
    url.searchParams.set('limit', '1000');
    const tasks = [];
    const headers = { apikey: config.SUPABASE_PUBLIC_KEY, Prefer: 'count=exact' };
    if (!config.SUPABASE_PUBLIC_KEY.startsWith('sb_publishable_')) {
      headers.Authorization = 'Bearer ' + config.SUPABASE_PUBLIC_KEY;
    }
    while (true) {
      url.searchParams.set('offset', String(tasks.length));
      const result = await request(url.toString(), headers);
      if (!Array.isArray(result.data) || result.data.some(task => !task ||
          task.region !== region || !['야외', '고소', '실내'].includes(task.kind) ||
          typeof task.title !== 'string' || typeof task.owner !== 'string')) {
        throw new Error('DB 일정 응답 형식 오류');
      }
      tasks.push(...result.data);
      const range = result.headers.get('content-range');
      const total = range && /\/(\d+)$/.exec(range);
      if (!result.data.length || (total ? tasks.length >= Number(total[1]) : result.data.length < 1000)) {
        return tasks;
      }
    }
  }

  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'GET으로 호출해 주세요.' } });
    }
    const query = new URL(req.url, 'https://local.invalid').searchParams;
    const regions = query.getAll('region');
    const region = regions[0];
    if (regions.length !== 1 || !Object.hasOwn(REGIONS, region)) {
      return res.status(400).json({ error: {
        code: 'INVALID_REGION', message: 'region은 세종·대전·태안·보령 중 하나를 한 번만 지정해 주세요.',
      } });
    }
    if (typeof config.SUPABASE_URL !== 'string' || !/^https:\/\//.test(config.SUPABASE_URL) ||
        !isPublicSupabaseKey(config.SUPABASE_PUBLIC_KEY)) {
      return res.status(503).json({ error: { code: 'DB_CONFIG_MISSING', message: 'Supabase 공개 연결 설정을 확인해 주세요.' } });
    }

    const period = kmaForecastPeriod(clock());
    let tasks;
    try {
      tasks = await readTasks(region);
    } catch (error) {
      // 외부 응답과 에러 객체에는 URL·인증 정보가 있을 수 있으므로 그대로 반환하거나 기록하지 않는다.
      return res.status(502).json({ error: { code: 'DB_UNAVAILABLE', message: 'DB 일정을 읽지 못했습니다.' } });
    }
    let weather = null;
    let warning = null;
    const key = getKmaKey();
    if (!key || !key.trim()) {
      warning = { code: 'KMA_KEY_MISSING', message: 'Vercel의 KMA_KEY 환경변수를 확인해 주세요.' };
    } else {
      try {
        const result = await request(buildKmaUrl(region, key, period));
        weather = parseKmaResponse(result.data, period.date);
      } catch (error) {
        warning = { code: 'WEATHER_UNAVAILABLE', message: '기상청 오늘 예보를 받지 못했습니다. 인증키 발급처·활용 승인·호출 한도를 확인해 주세요.' };
      }
    }
    return res.status(200).json({
      date: period.date, region, source: '기상청 단기예보 (공공데이터포털)',
      forecast: { baseDate: period.baseDate, baseTime: period.baseTime, timezone: 'Asia/Seoul' },
      units: { tempMax: '℃', windMax: 'm/s', rainProb: '%' },
      weather, warning,
      tasks: tasks.map(task => ({ id: task.id, title: task.title, region: task.region,
        kind: task.kind, owner: task.owner, weather, judgment: judge(task.kind, weather) })),
    });
  };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
