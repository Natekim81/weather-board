// logic.js – 판단 규칙만 (화면을 다루는 코드 금지)

// 교육용 가상 기준 (실제 작업 중지 · 행사 취소 기준은 각 기관 규정을 따름)
const RULES = { wind: 10, rain: 60, heat: 33 };

// 지역 대표 좌표 (위도, 경도)
const REGIONS = {
  '세종': { latitude: 36.4800, longitude: 127.2890 },
  '대전': { latitude: 36.3504, longitude: 127.3845 },
  '태안': { latitude: 36.7456, longitude: 126.2980 },
  '보령': { latitude: 36.3335, longitude: 126.6128 },
};

// 위 대표 좌표에 대응하는 기상청 5km 예보 격자.
const KMA_GRIDS = {
  '세종': { nx: 66, ny: 103 },
  '대전': { nx: 67, ny: 100 },
  '태안': { nx: 48, ny: 109 },
  '보령': { nx: 54, ny: 100 },
};

function isPublicSupabaseKey(key) {
  if (typeof key !== 'string') return false;
  if (key.startsWith('sb_publishable_')) return true;
  try {
    const payload = key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(payload)).role === 'anon';
  } catch (error) {
    return false;
  }
}

function kmaForecastPeriod(now = new Date()) {
  return {
    date: koreanDate(now),
    // 전날 23시 예보를 사용해 오늘 00~23시 전체를 포함한다.
    baseDate: koreanDate(new Date(now.getTime() - 86400000)).replace(/-/g, ''),
    baseTime: '2300',
  };
}

function buildKmaUrl(region, key, period) {
  if (!Object.hasOwn(KMA_GRIDS, region)) throw new Error('지원하지 않는 지역');
  if (typeof key !== 'string' || !key.trim()) throw new Error('기상청 키 없음');
  let serviceKey = key.trim();
  // 공공데이터포털의 Encoding·Decoding 키 모두 한 번만 URL 인코딩한다.
  if (/%[0-9a-f]{2}/i.test(serviceKey)) serviceKey = decodeURIComponent(serviceKey);
  const params = new URLSearchParams({
    serviceKey, pageNo: '1', numOfRows: '1000', dataType: 'JSON',
    base_date: period.baseDate, base_time: period.baseTime,
    nx: KMA_GRIDS[region].nx, ny: KMA_GRIDS[region].ny,
  });
  return 'https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst?' + params;
}

function parseKmaResponse(data, date) {
  const response = data && data.response;
  if (!response || !response.header || response.header.resultCode !== '00') {
    throw new Error('기상청 예보 조회 실패');
  }
  const items = response.body && response.body.items && response.body.items.item;
  if (!Array.isArray(items)) throw new Error('기상청 예보 없음');
  const series = { TMP: new Map(), WSD: new Map(), POP: new Map() };
  const dailyMax = [];
  for (const item of items) {
    if (!item || item.fcstDate !== date.replace(/-/g, '') ||
        !/^(?:[01]\d|2[0-3])00$/.test(item.fcstTime)) continue;
    if (!Object.hasOwn(series, item.category) && item.category !== 'TMX') continue;
    if (typeof item.fcstValue !== 'string' && typeof item.fcstValue !== 'number') continue;
    if (String(item.fcstValue).trim() === '') continue;
    const value = Number(item.fcstValue);
    if (!Number.isFinite(value)) continue;
    if ((item.category === 'TMP' || item.category === 'TMX') && (value < -100 || value > 100)) continue;
    if (item.category === 'WSD' && value < 0) continue;
    if (item.category === 'POP' && (value < 0 || value > 100)) continue;
    if (item.category === 'TMX') dailyMax.push(value);
    else series[item.category].set(item.fcstTime, value);
  }
  // 일부 시간만 받은 값을 하루 최댓값으로 오인하지 않는다.
  if (Object.values(series).some(values => values.size !== 24)) {
    throw new Error('오늘 하루 예보가 불완전함');
  }
  return {
    tempMax: Math.max(...series.TMP.values(), ...dailyMax),
    windMax: Math.max(...series.WSD.values()),
    rainProb: Math.max(...series.POP.values()),
  };
}

function buildWeatherUrl(region) {
  const coordinates = REGIONS[region];
  if (!coordinates) throw new Error('지원하지 않는 지역');
  const params = new URLSearchParams({
    latitude: coordinates.latitude,
    longitude: coordinates.longitude,
    daily: 'temperature_2m_max,wind_speed_10m_max,precipitation_probability_max',
    temperature_unit: 'celsius',
    wind_speed_unit: 'ms',
    timezone: 'Asia/Seoul',
    forecast_days: '1',
  });
  return 'https://api.open-meteo.com/v1/forecast?' + params.toString();
}

function parseWeatherResponse(data) {
  const daily = data && data.daily;
  const w = {
    tempMax: daily && daily.temperature_2m_max && daily.temperature_2m_max[0],
    windMax: daily && daily.wind_speed_10m_max && daily.wind_speed_10m_max[0],
    rainProb: daily && daily.precipitation_probability_max && daily.precipitation_probability_max[0],
  };
  if (!data || data.error || !daily || !daily.time || !daily.time[0] ||
      !Object.values(w).every(Number.isFinite) ||
      w.windMax < 0 || w.rainProb < 0 || w.rainProb > 100) {
    throw new Error('날씨 응답에 유효한 오늘 예보가 없음');
  }
  return w;
}

// API 실패 시에도 강풍 규칙을 시험하되, 기온과 강수확률은 만들지 않는다.
function applyWindTest(w, enabled) {
  return enabled ? { tempMax: null, rainProb: null, ...w, windMax: 12 } : w;
}

// 일정 구분과 날씨로 판단 (w가 없으면 '날씨 확인 전')
function judge(kind, w) {
  if (kind === '실내') return { level: 'ok', text: '영향 없음' };
  if (!w) return { level: 'none', text: '날씨 확인 전' };
  if (kind === '고소' && w.windMax >= RULES.wind) return { level: 'stop', text: '중지 검토' };
  if (![w.tempMax, w.windMax, w.rainProb].every(Number.isFinite)) return { level: 'none', text: '날씨 확인 전' };
  if (w.tempMax >= RULES.heat) return { level: 'warn', text: '폭염 휴식' };
  if (w.rainProb >= RULES.rain) return { level: 'warn', text: '우천 주의' };
  return { level: 'ok', text: '진행' };
}

function koreanDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const part = type => parts.find(p => p.type === type).value;
  return part('year') + '-' + part('month') + '-' + part('day');
}

// 화면에서 읽은 셀 문자열만 받아 Markdown을 만든다. DOM·다운로드 처리는 app.js에서 한다.
function buildJudgmentMarkdown(rows, date, windTest = false) {
  const escapeCell = value => String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/[\\`*_\[\]|~]/g, '\\$&')
    .replace(/\r\n|\r|\n/g, '<br>');
  const lines = ['# 현장 일정 판단 — ' + date, ''];
  if (windTest) lines.push('강풍 시험 모드: 풍속 12 m/s는 시험값입니다.', '');
  lines.push('| 일정 | 지역 | 구분 | 담당 | 날씨 | 판단 |',
    '| --- | --- | --- | --- | --- | --- |');
  for (const row of rows) {
    lines.push('| ' + row.map(escapeCell).join(' | ') + ' |');
  }
  lines.push('', '판단 기준(교육용): 고소 풍속 ' + RULES.wind +
    ' m/s 이상 → 중지 검토 · 강수확률 ' + RULES.rain +
    '% 이상 → 우천 주의 · 최고 기온 ' + RULES.heat + '℃ 이상 → 폭염 휴식');
  return lines.join('\n') + '\n';
}

if (typeof module !== 'undefined') module.exports = {
  RULES, REGIONS, buildWeatherUrl, parseWeatherResponse, applyWindTest, judge,
  koreanDate, buildJudgmentMarkdown,
  KMA_GRIDS, isPublicSupabaseKey, kmaForecastPeriod, buildKmaUrl, parseKmaResponse,
};
