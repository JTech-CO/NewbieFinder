# NewbieFinder

> **치지직에서 지금 방송 중인 소규모 스트리머를, 시청자 수와 팔로워 수 조건으로 찾아 주는 크롬 확장 프로그램**

## 1. 소개 (Introduction)

치지직의 기본 탐색 화면은 인기 방송과 추천 방송을 중심으로 구성됩니다. 그래서 시청자와 팔로워가 적은 스트리머는 아무리 방송을 켜도 눈에 띄기 어렵습니다. NewbieFinder는 치지직이 공개한 라이브 정보를 읽기 전용으로 훑어, 사용자가 정한 시청자 수·팔로워 수 상한을 만족하는 방송만 따로 모아 보여 줍니다.

로그인하지 않아도 동작합니다. 네이버 계정, 로그인 쿠키, 액세스 토큰을 요구하지 않고, 별도의 서버 없이 브라우저 안에서만 처리합니다. 자세한 소개는 [제품 페이지](https://jtech-co.github.io/NewbieFinder/docs/index.html)에 있습니다.

**주요 기능**

- **규모 조건 탐색**: 시청자 수 `1~30명`, 팔로워 수 `1~100명` 범위에서 상한을 정합니다. 두 조건을 함께 켜면 둘 다 만족하는 방송만 남습니다.
- **조건 의존형 최근 정렬**: `최근 시작 순`은 규모 조건이 하나 이상 켜져 있을 때만 쓸 수 있습니다. 방송을 막 켠 대형 채널이 결과를 덮는 일을 막습니다.
- **정직한 탐색 범위 표시**: 어디까지 확인했는지, 전부 확인한 것인지 일부인지를 항상 함께 보여 줍니다. 데이터가 불완전하면 `부분 결과`로 명시합니다.
- **로그인·서버·추적 없음**: 쿠키와 계정 정보를 읽지 않고, 수집한 데이터를 외부로 보내지 않으며, 분석·광고 SDK를 넣지 않았습니다.
- **다크 테마 반응형 UI**: 검정·흰색·형광 초록 세 색만 쓰는 단일 다크 테마이며, 키보드만으로 모든 조작이 가능합니다.

> **‘뉴비’의 의미**: NewbieFinder의 ‘뉴비’는 시청자 수와 팔로워 수를 기준으로 찾은 소규모 라이브 후보입니다. 실제 채널 개설일이나 방송 경력을 뜻하지 않습니다.

## 2. 기술 스택 (Tech Stack)

- **Platform**: Chrome Extension Manifest V3 (최소 Chrome 120)
- **Frontend**: React 19, TypeScript, CSS Custom Properties
- **Build**: Vite 6
- **Validation**: Zod (비공식 API 응답 런타임 검증)
- **State Management**: `useReducer` + Selector (외부 상태 관리 라이브러리 없음)
- **Storage**: `chrome.storage` (sync / local / session)
- **Test**: Vitest, Testing Library, Playwright
- **Backend**: 없음

## 3. 설치 및 실행 (Quick Start)

**요구 사항**: Node.js 20 이상

1. **설치 (Install)**

   ```bash
   git clone https://github.com/jtech-co/NewbieFinder.git
   cd NewbieFinder
   npm ci
   ```

2. **빌드 (Build)**

   환경 변수는 사용하지 않습니다. API 키나 시크릿이 없으므로 `.env` 설정도 필요 없습니다.

   ```bash
   npm run build
   ```

3. **브라우저에 올리기 (Load)**

   `chrome://extensions` → 개발자 모드 켜기 → **압축해제된 확장 프로그램을 로드** → `dist/` 폴더 선택.
   치지직(`https://chzzk.naver.com`) 탭에서만 툴바 아이콘이 활성화되고, 클릭하면 Finder가 새 탭으로 열립니다.

**그 밖의 명령어**

```bash
npm run dev               # Vite 개발 서버 (UI 확인용)
npm run lint              # ESLint
npm run typecheck         # TypeScript 타입 검사
npm test                  # 유닛·통합 테스트 (Vitest)
npm run test:e2e          # 확장을 실제로 로드하는 E2E (Playwright, 빌드 후 실행)
npm run validate:manifest # 권한·CSP·번들 정책 검증
npm run package           # release/ 에 배포용 ZIP 생성
npm run contract:live     # 실제 API 계약 점검 (수동 실행 전용)
```

## 4. 폴더 구조 (Structure)

```text
src/
├── background/     # Service Worker: 아이콘 활성화 규칙, Finder 탭 열기
├── finder/         # 확장 내부 Finder 페이지 (React)
│   ├── components/ # UI 컴포넌트
│   ├── hooks/      # 설정·탐색·시계 훅
│   └── styles/     # 디자인 토큰과 CSS
├── application/    # 탐색 오케스트레이션, 팔로워 조회, 요청 예산
├── domain/         # 모델·필터·정렬·날짜·오류 (외부 의존 없음)
├── infrastructure/ # 치지직 응답 어댑터, 네트워크, 저장소
└── shared/         # 상수, URL 검증, 공용 타입
```

계층 의존 방향은 `finder → application → domain ← infrastructure` 입니다. `domain`은 Chrome API, React, 네트워크 구현을 알지 못합니다.

그 밖의 최상위 폴더는 다음과 같습니다.

```text
public/   # manifest.json, 아이콘, 대체 이미지
tests/    # unit · integration · e2e · fixtures
scripts/  # 빌드·검증·패키징·아이콘 생성
docs/     # 공개 페이지(HTML)와 마크다운 원본(reference/)
```

## 5. 정보 (Info)

- **License**: MIT ([LICENSE](LICENSE))
- **Contact**: [GitHub Issues](https://github.com/jtech-co/NewbieFinder/issues)
- **변경 이력**: [CHANGELOG.md](CHANGELOG.md)

**공개 페이지**

| 페이지 | 주소 |
|---|---|
| 제품 소개 | <https://jtech-co.github.io/NewbieFinder/docs/index.html> |
| 개인정보 처리방침 | <https://jtech-co.github.io/NewbieFinder/docs/privacy.html> |
| 권한 설명 | <https://jtech-co.github.io/NewbieFinder/docs/permissions.html> |
| 아키텍처 | <https://jtech-co.github.io/NewbieFinder/docs/architecture.html> |
| 데이터 계약 위험 | <https://jtech-co.github.io/NewbieFinder/docs/contract-risk.html> |

저장소 설정에서 **Pages → Deploy from a branch → main / (root)** 를 선택하면 위 주소로 게시됩니다. 저장소 최상위의 `.nojekyll` 은 Pages 가 저장소 전체를 Jekyll 로 처리하다 실패하는 것을 막는 빈 파일이므로 지우지 마세요.

각 페이지는 [docs/reference/](docs/reference/) 안의 같은 문서와 내용이 같으며, **한쪽을 고치면 다른 쪽도 함께 고쳐야 합니다.**

**데이터 소스에 관한 고지**

NewbieFinder는 치지직 웹 클라이언트가 사용하는 공개 응답을 읽습니다. 공식 Open API가 아니므로 사전 공지 없이 형식이 바뀌거나 중단될 수 있습니다. 그런 경우 확장은 잘못된 결과를 보여 주는 대신 오류 상태로 멈추며, 접근이 제한되면 우회하지 않습니다. 관련 위험과 대응은 [CONTRACT_RISK.md](docs/reference/CONTRACT_RISK.md)에 정리했습니다.

**NewbieFinder는 NAVER 또는 CHZZK의 공식 서비스가 아닌 독립적인 브라우저 확장 프로그램입니다.**
