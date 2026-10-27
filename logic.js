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

if (typeof module !== 'undefined') module.exports = {
  RULES, REGIONS, buildWeatherUrl, parseWeatherResponse, applyWindTest, judge,
};
