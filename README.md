# 현장 일정 날씨판

오늘 현장 일정과 지역별 날씨를 한 화면에서 보고, 날씨 때문에 주의 · 중지를 검토할 일정을 표시합니다. (교육용 가상 데이터)

## 여는 법
- 아래 Supabase 설정 후 배포 주소(HTTP/HTTPS) 또는 `index.html` 더블클릭으로 엽니다. CDN과 Supabase·날씨 API 접속을 위해 인터넷 연결이 필요합니다.
- 인터넷 : (배포 후 Vercel 주소를 여기에 적기)

## 파일
| 파일 | 역할 |
|---|---|
| index.html | 화면 구조 |
| style.css | 디자인 |
| logic.js | 판단 규칙, 날씨 API 주소 생성·응답 해석, Markdown 생성 |
| app.js | 화면 동작, Supabase 일정 조회·추가, 날씨 API 호출 |
| config.js | 브라우저·서버 공용 Supabase 주소와 공개용 키 두 줄 |
| api/kma.js | Vercel에서 지역별 DB 일정·기상청 날씨·판단 JSON 조회 |
| tests/kma.test.js | 기상청 처리·서버 API·공용 설정 회귀 테스트 |
| setup.sql | DB 표·제약·권한·RLS·기본 가상 일정 6건 설정 |
| data/tasks.json | 이전 F-05 실습 자료 (현재 앱은 읽지 않음) |
| PRD.md | 무엇을 · 왜 만드는지 |
| CLAUDE.md | AI가 지킬 작업 규칙 |
| .gitignore | GitHub에 올리지 않을 파일 목록 |

## Supabase 설정 (F-06)
1. Supabase 프로젝트의 SQL Editor에서 `setup.sql` 전체를 실행합니다. 앱은 SQL을 자동 실행하지 않습니다. `public.wx_tasks`가 없는 프로젝트에서 시작하는 설정이며, 이 스크립트로 만든 표에는 다시 실행해도 기본 일정이 중복되지 않습니다.
2. Supabase 프로젝트의 Connect 또는 Settings → API Keys에서 프로젝트 주소와 **Publishable key**를 확인합니다. 기존 **anon key**도 사용할 수 있습니다. 비밀 키인 **Secret key / service_role key**는 사용하지 마세요.
3. `config.js`의 두 줄에 직접 입력합니다. 이 파일은 브라우저에서 읽히며, 공개용 키는 RLS가 허용하는 조회·추가에만 사용됩니다.

   ```js
   (typeof module === 'undefined' ? globalThis : module.exports).SUPABASE_URL = 'https://YOUR_PROJECT.supabase.co';
   (typeof module === 'undefined' ? globalThis : module.exports).SUPABASE_PUBLIC_KEY = 'sb_publishable_YOUR_PUBLIC_KEY';
   ```

4. 페이지를 열어 기본 일정 6건을 확인합니다. 설정 변경을 배포 사이트에 반영하려면 변경한 `config.js`도 배포해야 합니다.

- `wx_tasks`는 `id`, `title`, `region`, `kind`, `owner`, `created_at` 열을 가집니다. 목록은 `id` 오름차순으로 읽습니다.
- DB의 `NOT NULL`·`CHECK`가 빈 일정명·담당, 지역(세종·대전·태안·보령)과 구분(야외·고소·실내) 외의 값을 거부합니다.
- RLS와 권한으로 로그인 없는 방문자의 조회·추가만 허용합니다. 수정·삭제는 허용하지 않습니다. 방문자 누구나 가상 일정을 조회·추가할 수 있는 교육용 설정입니다.
- JSON이나 Local Storage는 조회·저장에 사용하지 않습니다. 기존 `wx_added`와 JSON 자료는 자동으로 이관하거나 삭제하지 않습니다.
- 추가는 DB 저장 결과를 확인한 뒤 화면에 표시합니다. 저장 중 중복 클릭을 막고, 실패하면 입력을 유지합니다. 통신 오류로 결과가 불확실하면 새로고침해서 실제 저장 여부를 먼저 확인합니다.
- 다른 브라우저에서 추가한 일정은 새로고침하면 보입니다. 실시간 구독은 사용하지 않습니다.
- 공개용 키를 검증한 뒤 클라이언트를 만들며, 인증 세션 저장과 자동 갱신을 사용하지 않습니다. 외부 스크립트는 CDN의 `supabase-js` 하나뿐입니다.

## 오늘 날씨 (F-04)
- 키가 필요 없는 [Open-Meteo 예보 API](https://open-meteo.com/en/docs)를 사용합니다. 인터넷 연결이 필요합니다.
- 세종·대전·태안·보령의 대표 좌표로 한국 시간(`Asia/Seoul`) 기준 오늘 하루 예보를 요청합니다.
- 일별 최고 기온(`temperature_2m_max`), 최대 풍속(`wind_speed_10m_max`, `wind_speed_unit=ms`), 최대 강수확률(`precipitation_probability_max`)을 표시합니다.
- 실내는 항상 ‘영향 없음’입니다. 나머지는 고소 강풍(10 m/s 이상) → 폭염(33℃ 이상) → 우천(60% 이상) 순서로 하나만 표시하고, 해당 사항이 없으면 ‘진행’입니다.
- 지역별 요청은 10초 후 중단합니다. 실패하거나 예보 값이 누락된 지역은 날씨 ‘-’, 판단 ‘날씨 확인 전’으로 표시하며 목록과 일정 추가는 계속 사용할 수 있습니다. 실내 판단은 ‘영향 없음’입니다.

## 지역별 JSON API (F-07)
- 호출: `https://배포주소/api/kma?region=대전` (GET). 세종·대전·태안·보령만 지정할 수 있습니다.
- Supabase `wx_tasks`에서 해당 지역의 일정을 조회하고, 기상청 오늘 날씨와 일정별 `judgment`를 반환합니다. 일정이 없으면 `tasks: []`입니다.
- Vercel의 프로젝트 Settings → Environment Variables에 **KMA_KEY**를 설정하고 새로 배포합니다. Production에 적용해야 운영 주소에서 읽을 수 있습니다. Preview 주소에서도 시험하려면 Preview에도 적용합니다. 키는 이 저장소나 `config.js`에 넣지 않습니다.
- 현재 연결 대상은 [공공데이터포털 기상청 단기예보 조회서비스](https://www.data.go.kr/data/15084084/openapi.do)의 `getVilageFcst`입니다. 해당 서비스의 활용 승인이 필요합니다. 기상청 API허브에서 발급한 키는 이 호출에 사용할 수 없습니다. 발급처는 아직 확인되지 않아 공공데이터포털을 전제로 구현했습니다.
- 공공데이터포털의 Encoding·Decoding 키를 모두 처리하며, 인증키가 든 URL이나 외부 오류 원문은 로그·응답에 넣지 않습니다.
- 전날 23시 발표 예보에서 한국 시간 기준 오늘 00~23시를 읽습니다. 응답의 `forecast.baseDate`·`baseTime`이 사용한 발표 시각입니다. 기온 TMP·최고기온 TMX, 풍속 WSD, 강수확률 POP로 일별 최댓값을 계산합니다. 바람은 m/s입니다. 필요한 24시간 값이 누락되면 날씨를 미수신으로 처리합니다.
- 날씨 실패·키 미설정 시 `weather: null`과 `warning`이 나오며 DB 일정은 남습니다. 실내는 ‘영향 없음’, 그 외는 ‘날씨 확인 전’입니다. DB 실패는 502, 설정 오류는 503이며 다른 자료로 대체하지 않습니다. 외부 요청에는 8초 제한을 둡니다.
- 이 API는 DB를 변경하지 않습니다. 기존 화면·Markdown 저장은 현재 표와 Open-Meteo 결과를 그대로 사용하므로 기상청 API의 값과 다를 수 있습니다. 로컬 더블클릭으로는 서버 API를 실행할 수 없습니다.

응답 구조 예시입니다. 숫자와 일정은 설명용 가상 값입니다.

```json
{
  "date": "2026-10-27",
  "region": "대전",
  "source": "기상청 단기예보 (공공데이터포털)",
  "forecast": { "baseDate": "20261026", "baseTime": "2300", "timezone": "Asia/Seoul" },
  "units": { "tempMax": "℃", "windMax": "m/s", "rainProb": "%" },
  "weather": { "tempMax": 25, "windMax": 3, "rainProb": 20 },
  "warning": null,
  "tasks": [
    {
      "id": 1, "title": "가상 점검", "region": "대전", "kind": "야외", "owner": "가상담당",
      "weather": { "tempMax": 25, "windMax": 3, "rainProb": 20 },
      "judgment": { "level": "ok", "text": "진행" }
    }
  ]
}
```

## 확인 방법
- **T-01**: SQL 실행과 연결 설정 후 페이지를 열어 DB의 기본 일정 6건이 보이는지 확인합니다. DB에 추가한 일정이 있으면 함께 표시됩니다.
- **T-02**: 가상 일정을 추가해 맨 아래에 보이고, Supabase Table Editor에도 저장되는지 확인합니다. 새로고침 후에도 남아야 합니다. 날씨 수신 후 추가한 일정에도 해당 지역의 날씨와 판단이 표시됩니다.
- **T-03**: 인터넷에 연결한 상태로 열어 4개 지역의 최고 기온·최대 풍속(m/s)·강수확률과 판단을 확인합니다. 같은 지역 일정은 같은 날씨를 사용합니다. 실제 예보에 따라 지역 간 일부 값은 같을 수 있습니다.
- **T-04**: 브라우저 주소 끝에 `?test=wind`를 붙여 엽니다 (`index.html?test=wind`). 모든 지역의 풍속이 12 m/s로 표시되고 기본 고소 일정 2건이 ‘중지 검토’인지 확인합니다. 상단에 시험값 안내가 표시됩니다. API 실패 시에도 풍속만 시험값으로 표시하고, 기온·강수확률은 ‘미수신’으로 남깁니다. 시험을 끝내려면 쿼리 문자열을 제거합니다.
- **T-01·T-03 실패 상황**: `?test=wind`를 제거하고 개발자 도구에서 날씨 API 요청만 차단한 뒤 새로고침합니다. DB 일정 목록은 유지되고, 상단에 실패 지역이 표시되며 실외 일정은 ‘날씨 확인 전’, 실내 일정은 ‘영향 없음’인지 확인합니다.
- **T-05·T-06**: 이전 JSON 로딩·파일 실패 안내 검사는 F-06에서 아래 T-08·T-09로 대체합니다.
- **T-07**: ‘오늘 판단 md로 저장’을 눌러 `현장일정_판단_YYYY-MM-DD.md`가 내려받아지는지 확인합니다. 날짜는 한국 시간 기준입니다. 파일을 열어 현재 표의 6개 열과 추가 일정이 같은 순서로 들어 있고, 맨 아래 판단 기준에 풍속 10 m/s·강수확률 60%·기온 33℃가 있는지 확인합니다. 날씨 미수신 상태와 `?test=wind`에서도 현재 표가 저장되며, 시험 모드에서는 시험값 안내가 포함됩니다. 일정 이름에 `|`, 줄바꿈, `<` 등이 있어도 Markdown 표가 유지되는지 확인합니다.

- **T-08**: 브라우저 A에서 가상 일정을 추가하고 브라우저 B(또는 시크릿 창)에서 새로고침해 같은 일정이 보이는지 확인합니다. 이전 Local Storage가 목록에 섞이지 않아야 합니다.
- **T-09**: 빈 연결 설정, CDN 차단, DB 조회 차단 시 각각 안내가 보이고 추가 버튼이 비활성화되는지 확인합니다. 목록을 받은 후 DB 저장 요청을 차단해 추가하면 기존 목록과 입력이 유지되고 저장 실패 안내가 보여야 합니다.
- **T-10**: SQL Editor에서 아래 검증 SQL을 실행합니다. 각각 의도적으로 실패해야 하며, 실패한 문장은 한 번에 하나씩 실행합니다. 정상 기본 일정은 그대로 남습니다.

  ```sql
  -- 지역·구분 CHECK 제약 (각 문장을 따로 실행)
  insert into public.wx_tasks (title, region, kind, owner)
  values ('가상 제약 검사', '서울', '야외', '가상담당');
  insert into public.wx_tasks (title, region, kind, owner)
  values ('가상 제약 검사', '세종', '기타', '가상담당');
  ```

- **T-11**: SQL Editor에서 다음 블록을 실행하면 `permission denied`로 실패해야 합니다. 실패 후 `rollback;`을 실행해 테스트 트랜잭션을 끝냅니다. `setup.sql` 재실행 후 기본 일정이 중복되지 않는지도 확인합니다.

  ```sql
  begin;
  set local role anon;
  delete from public.wx_tasks where false;
  rollback;
  ```

- **T-12**: 최신 배포의 `/api/kma?region=대전`을 열어 `tasks`가 DB의 대전 일정과 일치하는지 확인합니다. 다른 3개 지역도 확인합니다. `weather` 값과 `judgment`를 확인합니다.
- **T-13**: `?region=서울`, 지역 생략, `?region=대전&region=세종`은 400인지, POST는 405인지 확인합니다. DB 설정이 잘못되거나 DB 조회가 실패하면 성공한 빈 목록으로 위장하지 않고 503·502가 나와야 합니다.
- **T-14**: 테스트 배포에서 KMA_KEY를 빼거나 날씨 호출이 실패하도록 설정하면 DB 일정과 `weather: null`, `warning`이 나오는지 확인합니다. 응답에 인증키가 없어야 합니다. 점검 후 환경변수를 복구하고 재배포합니다.
- **T-15**: Node.js가 설치된 PC에서 `node --test tests/kma.test.js`를 실행합니다. 실제 외부 API·DB 변경 없이 한국 날짜·최댓값·예보 누락·규칙·서버 오류·공용 설정·화면 기능을 검증합니다.
