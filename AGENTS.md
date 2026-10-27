# AGENTS.md – 현장 일정 날씨판 작업 규칙

> Codex용 규칙 파일입니다. CLAUDE.md와 내용이 같습니다. 한쪽을 고치면 다른 쪽도 같이 고칩니다.

## 프로젝트 개요
- 교육용 프로토타입이다. 무엇을 만들지는 PRD.md를 따른다.
- PRD.md에 없는 기능은 먼저 제안하고, 내가 승인한 뒤에만 구현한다.

## 기술 스택 (변경 금지)
- HTML + CSS + 순수 JavaScript만 사용한다. (React 등 프레임워크, 빌드 도구 사용 금지)
- index.html 을 더블클릭해서 열 수 있어야 한다.
- F-07의 /api/kma는 Vercel Node.js Function으로 실행한다. 서버 API는 배포 주소에서 사용한다.

## 폴더 구조
- index.html : 화면 구조
- style.css  : 디자인
- logic.js   : 판단 규칙만 (화면을 다루는 코드 금지)
- app.js     : 화면 동작 (목록 그리기, 일정 추가)
- api/kma.js : 지역별 DB 일정·기상청 날씨·판단 조회 (서버)
- config.js  : 브라우저·서버 공용 Supabase 주소·공개용 키 두 줄
- PRD.md · AGENTS.md · CLAUDE.md · README.md : 문서

## 작업 방식
1. 코드를 고치기 전에 계획(수정할 파일과 이유)을 먼저 보여 주고 승인을 받는다.
2. 한 번에 한 가지만 고친다.
3. 끝나면 바꾼 파일, 내가 확인할 방법(T-번호), 남은 문제를 보고한다.

## 보안 · 데이터 규칙
- 일정 데이터는 Supabase의 public.wx_tasks 표에서 읽고 저장한다. JSON·브라우저 저장 목록으로 대체하지 않는다.
- config.js에는 Supabase 주소와 공개용 키(publishable 또는 anon) 두 줄만 둔다. secret·service_role 키는 사용하지 않는다.
- 외부 스크립트는 supabase-js 하나만 사용한다. DB에서도 지역·구분을 제한하고 RLS로 조회·추가만 허용한다.
- 가상 데이터만 사용한다. 실제 이름 · 연락처 · 기관 내부 자료를 넣지 않는다.
- 사용자가 입력한 글자는 textContent 로 표시한다.
- 비밀 키는 코드 · 채팅 · GitHub 에 넣지 않는다.
- 기상청 인증키는 서버 환경변수 KMA_KEY에서만 읽는다. 인증키가 든 호출 URL·외부 오류 원문을 응답·로그에 남기지 않는다.
