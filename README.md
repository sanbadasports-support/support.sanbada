# 산바다스포츠 지원 사이트 (support.sanbadasports.co.kr)

애플 지원 사이트처럼 **브랜드별 자주 발생하는 문제·FAQ·매뉴얼 안내 → A/S 접수 → 진행 조회**를 한곳에서 하는 정적 웹사이트입니다.
접수 내용은 먼데이 A/S 보드로 들어가므로, 기존 자동화(접수번호·대리점 자동 연결·시리얼 매칭·알림톡·제조사 엑셀)가 그대로 돕니다.

사람이든 AI든 이 문서만 읽으면 고칠 수 있게 정리했습니다.

## 1. 무엇을 어디서 고치나요

글자·FAQ·자료 링크는 **관리자 페이지**에서 고칩니다(코드 수정 필요 없음).

| 고치고 싶은 것 | 관리자 페이지 탭 |
|---|---|
| 공지 띠, 전화·주소·운영 시간, 첫 화면 문구, 대리점 찾기 링크, 개인정보 동의 문구 | 기본 설정 |
| 접수·조회 화면의 도움말·안내 문구 20개 | 화면 안내 문구 |
| 브랜드 이름·설명·순서, 「매뉴얼·자료」 링크 | 브랜드·자료 |
| 자주 묻는 질문 / 자주 발생하는 문제 (추가·삭제·순서·브랜드·증상 분류) | 자주 발생하는 문제 |
| 누가 언제 무엇을 바꿨는지 | 변경 기록 |
| 대리점 목록 | `data/dealers.json` (먼데이 「대리점리스트」에서 이름·지역만. 전화번호는 넣지 않음) |
| 화면 구성·디자인·접수 단계, 브랜드 추가·삭제 | `index.html` (코드 수정) |

### 관리자 페이지 구조 (`admin-worker/`)
- Cloudflare Worker `sanbada-admin` 으로 배포합니다. 고객용 사이트(GitHub Pages)와 따로 떨어져 있습니다.
- **잠금:** Cloudflare Access(Zero Trust)가 앞에서 회사 메일 인증 코드로 로그인시킵니다. Worker도 Access 토큰(`Cf-Access-Jwt-Assertion`)을 다시 검증하고, `ACCESS_TEAM`·`ACCESS_AUD` 가 비어 있으면 모든 요청을 거절합니다.
- **저장:** 「저장」 → Worker가 GitHub API로 `data/content.json` 을 커밋(메시지에 저장한 사람 메일) → GitHub Pages가 1~2분 안에 반영. 되돌리기는 GitHub 커밋 기록에서.
- **비밀값:** `GITHUB_TOKEN` (이 저장소 하나에만 Contents 읽기·쓰기 권한을 준 fine-grained 토큰). Cloudflare 대시보드에 「암호화」 변수로만 넣고, 코드·문서에 적지 않습니다.
- 파일: `admin-worker/worker.js`(API·로그인 검증), `admin-worker/public/index.html`(관리 화면), `admin-worker/wrangler.toml`(설정).
- 사이트(`index.html`)는 `data/content.json` 이 없거나 파일로 직접 열면 index.html 안의 기본값을 씁니다. 화면 안내 문구 키를 새로 만들면 index.html의 `CONTENT` 기본값과 관리 화면의 `TEXTS` 목록에 같이 추가하세요.

## 2. 파일 구조

```
index.html          화면 전체 (HTML + CSS + JS 한 파일, 빌드 과정 없음)
data/dealers.json   대리점 목록 [{id, n(이름), r(시·도), a(시·군·구)}]
admin-worker/       관리자 페이지 (Cloudflare Worker)
data/content.json   화면 문구·브랜드·FAQ·자료 (아래 형식)          ← 관리자 페이지가 저장
img/serial-*.jpg    브랜드별 시리얼 위치 사진
CNAME               GitHub Pages 도메인 (팀장 확인 후 추가: support.sanbadasports.co.kr)
```

`data/*.json` 이 없거나 파일로 직접 열었을 때(file://)는 `index.html` 안의 기본값을 씁니다. 그래서 index.html 하나만 더블클릭해도 동작합니다.

### content.json 형식
```json
{
  "settings": {"notice":"", "phone":"02-555-5199", "hours":"평일 09:00~18:00", "address":"...",
               "heroTitle":"...", "heroText":"...", "dealerFinder":"https://...", "consent":"HTML 허용(<b>, <br>)"},
  "brands": [{"id":"cannondale","name":"Cannondale","kind":"로드 · MTB · 전기자전거","order":1,
              "docs":[{"t":"사용 설명서 (PDF)","u":"https://..."}]}],
  "faq":    [{"q":"질문","a":"답(줄바꿈 \n)","t":"꼬리표","b":["cannondale"],"c":["elec"]}]
}
```
- 브랜드 코드: cannondale, birdy, strida, carryme, besv, enve, chapter2, linku, reach, garmin
- 증상 분류 코드: frame 프레임·도장, drive 변속·브레이크, wheel 휠·타이어, noise 소음·유격, elec 충전·모터·에러(전기자전거만), fold 접이 구조(폴딩만), parts 부품 구매, etc 기타
- `b` 가 비어 있으면 모든 브랜드 공통 FAQ(첫 화면에도 보임)
- 브랜드를 새로 넣으면 접수 단계·Make 접수 시나리오(브랜드 라벨 switch)에도 같은 코드를 추가해야 합니다.

## 3. 접수·조회가 먼데이로 가는 길 (웹훅 계약)

모든 요청은 `POST`, `application/x-www-form-urlencoded` 입니다(브라우저 사전 요청 없이 바로 전송). 응답은 JSON, `Access-Control-Allow-Origin: *`.

### 접수: `CONFIG.HOOK_SUBMIT` → Make 시나리오 7183259 「홈페이지 A/S 접수 → A/S 보드 등록·사진·AI 판독」
| 필드 | 값 |
|---|---|
| k | `sbs-as-2026` (Make 필터와 같아야 함) |
| hp | 빈칸 (스팸 방지용 숨은 칸. 값이 있으면 버림) |
| who | consumer / dealer / hq |
| kind | as / warranty |
| brand | 브랜드 코드 또는 tacx |
| model, serial, buy(YYYY-MM-DD), cat(분류 이름), symptom | 제품·증상 |
| name | 소비자 성함 (who=consumer) |
| dealer, dealer_name, staff | 대리점 아이템 ID(숫자), 이름, 매장 담당자 (who=dealer) |
| cname | 소비자 성함 (who=dealer/hq) |
| phone | 숫자만, 0으로 시작 |
| email, product_name, nphotos | 선택 |
| agree | 1 |
| ph_whole, ph_serial, ph_issue, ph_issue2, ph_issue3, ph_receipt | JPEG base64 (data: 앞부분 없이). 브라우저에서 긴 변 1600px로 줄여 보냄 |

응답: `{"ok":true,"no":"261125-07"}` (약 15초 뒤. 번호가 비면 알림톡으로 안내)

Make가 하는 일: A/S 보드(18437777836) 「① 신규접수」에 항목 생성 → 텍스트 칸 입력(사용자 글은 GraphQL 변수로만 넣음) → 12초 기다려 기존 시나리오 6959045가 매긴 접수번호를 읽어 응답 → 사진을 `<접수번호>_②시리얼.jpg` 식 이름으로 각 파일 칸에 업로드 → 시리얼을 비우고 시리얼 사진만 올렸으면 AI(OCR+판독)로 번호를 읽어 「시리얼넘버」에 넣고 「시리얼 확인 = AI 판독 (확인 필요)」.

### 조회: `CONFIG.HOOK_LOOKUP` → Make 시나리오 7183230 「홈페이지 조회 → 시리얼 자동완성·진행 조회」
- 시리얼 자동완성: `a=serial&q=<3자 이상>` → 제품리스트 보드 6개(Brompton 제외)에서 포함 검색, 보드마다 최대 4개.
  응답 `{"ok":true,"boards":[{"items_page":{"items":[{"id":"..","c":[{"id":"serial","text":".."},{"id":"product_name","text":".."}]}]}}]}`
- 진행 조회: `a=track&no=<접수번호>&ph=<연락처 뒤 4자리>` → 접수 연락처·대리점 휴대폰·대리점 대표번호 중 하나라도 뒤 4자리가 맞을 때만
  `{"ok":true,"found":true,"created":"..","cols":[{id,text}]}` (공개 칸만: 진행 상태, 브랜드, 모델, 구분, 송장번호, 입고일, 출고일, 대체품 발송일). 아니면 `{"ok":true,"found":false}`.
  내부 메모·처리 메모 칸은 절대 응답에 넣지 않습니다.

## 4. 설정값 (index.html 맨 위 `CONFIG`)
웹훅 주소 2개, 접수 키, 사진 크기(1600px)·품질, 자동완성 대기 시간, 제한 시간.

## 5. 배포 (GitHub Pages)
1. 이 폴더를 GitHub 저장소에 올림 → Settings → Pages → Branch `main` / root.
2. Custom domain = `support.sanbadasports.co.kr`, Enforce HTTPS 체크.
3. 도메인 관리 업체(홈페이지 업체)에 CNAME 레코드 요청: `support` → `<GitHub 계정>.github.io`

## 6. 나중에: 내 제품 등록 · 관련 부품
시리얼 → 제품리스트 매칭이 이미 되므로, 「내 제품 등록」(시리얼+연락처) 화면을 붙이면 제품 ID/제품코드로 부품 목록과 고도몰 상품 링크를 보여 줄 수 있습니다.
준비물: 제품코드 ↔ 부품 ↔ 고도몰 상품번호 표(먼데이 보드 또는 고도몰 API/엑셀 내보내기). 재고 수량은 WMS에서만 관리하므로 사이트에는 「구매 링크」만 둡니다.

## 보안: 접수·조회 문지기 (gate-worker)
- 목적: Make 웹훅 주소를 공개 코드에서 빼고, 가짜 접수 도배·Make 크레딧 소진·진행 조회 대입을 막음.
- 구조: 홈페이지 → `gate-worker`(Cloudflare Worker, 로그인 없음) → Make. 접수와 진행 조회는 Turnstile(사람 확인) 필수, IP당 1분 횟수 제한(접수 3·조회 8·시리얼 자동완성 40), 허용 사이트(Origin)만 받음, 숨은 칸(hp)이 채워진 요청은 버림.
- 켜는 순서: ① gate-worker 배포(루트 디렉터리 `gate-worker`) ② Turnstile 위젯 만들기(도메인 support.sanbadasports.co.kr, sanbadasports-support.github.io) ③ Worker 비밀값 HOOK_SUBMIT·HOOK_LOOKUP·SUBMIT_KEY·TURNSTILE_SECRET ④ index.html CONFIG의 GATE·TURNSTILE_SITEKEY 채우기 ⑤ 시험 후 Make 웹훅을 새로 발급해 Worker 비밀값만 바꾸고, CONFIG의 HOOK_SUBMIT·HOOK_LOOKUP·KEY는 지움.
- GATE·TURNSTILE_SITEKEY가 비어 있으면 예전처럼 Make로 바로 보냄(지금 상태).
