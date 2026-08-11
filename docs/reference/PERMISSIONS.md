# 권한 설명 (Permissions)

- 대상 제품: NewbieFinder v1.0.0 (Manifest V3)
- 최종 갱신일: 2026-08-11

NewbieFinder는 기능에 꼭 필요한 최소 권한만 요청합니다. 이 문서는 요청하는 권한 세 가지의 사용 목적과, **의도적으로 요청하지 않는 권한**을 함께 정리합니다.

---

## 1. 요청하는 권한

manifest 선언은 다음이 전부입니다.

```json
{
  "permissions": ["declarativeContent", "storage"],
  "host_permissions": ["https://api.chzzk.naver.com/*"]
}
```

### `declarativeContent`

> 치지직 웹사이트를 보고 있을 때만 NewbieFinder 아이콘을 활성화하기 위해 사용합니다. 페이지 내용을 읽지 않습니다.

- **무엇에 쓰나요**: 현재 탭의 호스트가 `chzzk.naver.com` 이고 HTTPS일 때만 툴바 아이콘을 활성 상태로 바꿉니다. 다른 사이트에서는 아이콘이 비활성 상태로 남고 클릭 이벤트가 발생하지 않습니다.
- **무엇을 하지 않나요**: 이 권한은 규칙을 브라우저에 등록할 뿐이며, 확장이 페이지의 DOM이나 텍스트를 읽지 않습니다. 규칙 판정은 브라우저가 수행합니다.
- **대안 검토**: 같은 동작을 Content Script로도 만들 수 있지만, Content Script는 페이지에 코드를 주입해야 하므로 권한 범위가 넓어집니다. 페이지 접근 없이 URL 조건만 보기 위해 이 권한을 선택했습니다.

### `storage`

> 사용자가 설정한 시청자·팔로워 조건과 짧은 기간의 공개 라이브 캐시를 브라우저 내부에 저장하기 위해 사용합니다.

- **무엇에 쓰나요**
  - `chrome.storage.sync`: 필터 설정 (조건 활성화 여부, 상한 값, 정렬 여부)
  - `chrome.storage.local`: 라이브·채널 공개 정보 캐시, 마지막 갱신 시각, 안내 닫힘 여부
  - `chrome.storage.session`: 새로고침 쿨다운과 요청 잠금 (브라우저 종료 시 삭제)
- **무엇을 하지 않나요**: 개인 식별 정보, 계정 정보, 방문 기록을 저장하지 않습니다. 저장한 값을 외부로 보내지 않습니다.
- **대안 검토**: `localStorage` 는 Service Worker와 공유하기 어렵고 MV3 환경에서 접근 방식이 제한되므로 제외했습니다.
- 자세한 보존 기간은 [`PRIVACY.md`](./PRIVACY.md)에 있습니다.

### `https://api.chzzk.naver.com/*` (호스트 권한)

> 현재 라이브와 채널의 공개 정보를 읽어 조건에 맞는 방송을 찾기 위해 사용합니다. 로그인 쿠키나 계정 정보는 읽지 않습니다.

- **무엇에 쓰나요**: 확장 내부 Finder 페이지에서 다음 두 경로에 GET 요청을 보냅니다.

  ```http
  GET https://api.chzzk.naver.com/service/v1/lives
  GET https://api.chzzk.naver.com/service/v1/channels/{channelId}
  ```

- **어떻게 보내나요**: 모든 요청은 인증 정보가 실리지 않도록 명시적으로 구성합니다.

  ```ts
  fetch(url, {
    method: "GET",
    credentials: "omit",      // 쿠키를 보내지 않습니다
    redirect: "error",        // 다른 호스트로 따라가지 않습니다
    referrerPolicy: "no-referrer",
    headers: { Accept: "application/json" },
    signal,
  });
  ```

- **무엇을 하지 않나요**
  - 쿠키와 `Authorization` 헤더를 설정하지 않습니다.
  - `User-Agent`, `Origin`, `Referer` 를 위장하지 않습니다.
  - 쓰기(POST/PUT/DELETE) 요청을 보내지 않습니다.
  - 요청 URL은 허용 목록(`origin === https://api.chzzk.naver.com` 이고 프로토콜이 `https:`)을 통과한 경우에만 사용합니다.
  - 요청은 사용자가 Finder를 열거나 새로고침했을 때만 발생하며, 주기적인 백그라운드 수집이 없습니다.
- **왜 `https://chzzk.naver.com/*` 는 요청하지 않나요**: 확장은 치지직 웹 페이지에 접근하지 않습니다. 결과 카드를 클릭하면 일반 링크처럼 새 탭이 열릴 뿐이며, 이 동작에는 호스트 권한이 필요하지 않습니다.

---

## 2. 사용하지 않는 권한

아래 권한은 **의도적으로 요청하지 않습니다.** 이 목록은 설계 결정이며, 기능 추가를 이유로 조용히 늘리지 않습니다. 권한이 늘어나야 하는 변경은 버전 증가와 함께 `CHANGELOG.md` 에 명시합니다.

| 권한 | 제외 이유 |
|---|---|
| `cookies` | 로그인 쿠키를 읽지 않습니다. |
| `activeTab` | 치지직 페이지 콘텐츠를 읽거나 조작하지 않습니다. |
| `scripting` | Content Script를 동적으로 주입하지 않습니다. |
| `tabs` | 새 탭 생성 자체에는 광범위한 탭 메타데이터 권한이 필요하지 않습니다. |
| `webRequest` | 요청을 감시하거나 변조하지 않습니다. |
| `declarativeNetRequest` | 네트워크 트래픽을 리다이렉트하지 않습니다. |
| `history` | 방문 기록을 사용하지 않습니다. |
| `identity` | OAuth를 사용하지 않습니다. |
| `notifications` | v1에서 브라우저 알림을 제공하지 않습니다. |
| `unlimitedStorage` | 캐시 크기를 스스로 제한하므로 필요하지 않습니다. |

추가로 다음 요소도 포함하지 않습니다.

- **Content Script**: v1에 존재하지 않습니다. 그 결과 치지직 페이지와의 CSS·DOM 충돌 가능성이 없습니다.
- **`default_popup`**: 팝업을 지정하지 않고, 아이콘 클릭 시 확장 내부 페이지를 새 탭으로 엽니다.
- **개발자 센터 등록·OAuth**: Client ID, Client Secret, Access Token을 발급받거나 저장하지 않으며 공식 Open API(`/open/v1/*`)를 호출하지 않습니다.

---

## 3. 콘텐츠 보안 정책 (CSP)

확장 페이지의 CSP는 다음과 같이 고정합니다.

```text
script-src 'self';
object-src 'none';
base-uri 'none';
form-action 'none';
connect-src 'self' https://api.chzzk.naver.com;
img-src 'self' data: https://*.pstatic.net https://*.akamaized.net;
style-src 'self';
font-src 'self';
```

- `unsafe-eval`, `unsafe-inline` 을 넣지 않습니다.
- 모든 실행 코드는 확장 패키지 안에 포함합니다. 원격 스크립트, CDN JavaScript, 원격 폰트를 로드하지 않습니다.
- `connect-src` 는 API 호스트 하나로 제한합니다. 호스트 권한과 같은 범위를 유지합니다.
- `img-src` 의 이미지 호스트 허용 목록은 코드의 `ALLOWED_IMAGE_HOST_SUFFIXES` 와 항상 같은 범위를 유지합니다. 허용 목록 밖의 썸네일은 로컬 대체 이미지로 표시합니다.

---

## 4. 사용자가 직접 확인하는 방법

권한 선언이 문서와 같은지 직접 확인하실 수 있습니다.

1. `chrome://extensions` 에서 NewbieFinder의 **세부정보**를 엽니다. 사이트 접근 권한이 `api.chzzk.naver.com` 하나인지 확인합니다.
2. 빌드된 `dist/manifest.json` 을 열어 `permissions`, `host_permissions`, `content_security_policy` 를 확인합니다.
3. Finder 탭에서 개발자 도구의 **네트워크** 탭을 열고 새로고침을 눌러, 요청이 `api.chzzk.naver.com` 외 다른 호스트로 나가지 않는지 확인합니다.
4. `npm run validate:manifest` 는 빌드 산출물의 권한·CSP·경로가 기준과 일치하는지 자동으로 검사합니다.

---

## 5. 접근 제한을 만났을 때

치지직이 `401`, `403`, `429` 를 반환하면 NewbieFinder는 **우회하지 않고 중단합니다.**

- 헤더를 위장해 재시도하지 않습니다.
- CAPTCHA나 봇 방어를 자동으로 통과시키지 않습니다.
- `429` 를 무시한 무한 재시도를 하지 않습니다. `Retry-After` 가 지나치게 길면 재시도 없이 `RATE_LIMITED` 로 멈춥니다.
- 접근 정책이 바뀌어 기능이 유지될 수 없다면 우회를 추가하는 대신 제품 범위를 다시 검토합니다.

---

## 6. 비제휴 고지

> NewbieFinder는 NAVER 또는 CHZZK의 공식 서비스가 아닌 독립적인 브라우저 확장 프로그램입니다.
