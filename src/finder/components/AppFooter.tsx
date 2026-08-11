import { formatRelativeUpdate } from "../../domain/date";
import { EXTENSION_NAME, EXTENSION_VERSION } from "../../shared/constants";

/** 작은 글씨로 숨기지 않는다. 뉴비 정의와 비제휴 고지는 상시 노출한다. */

export interface AppFooterProps {
  readonly lastUpdatedAt: number | null;
  readonly now: number;
}

export function AppFooter({ lastUpdatedAt, now }: AppFooterProps) {
  return (
    <footer className="nf-footer">
      <div className="nf-footer__inner">
        <section className="nf-footer__block">
          <h2 className="nf-footer__title">‘뉴비’의 의미</h2>
          <p className="nf-footer__note">
            {EXTENSION_NAME}의 ‘뉴비’는 시청자 수와 팔로워 수를 기준으로 찾은 소규모 라이브
            후보입니다. 실제 채널 개설일이나 방송 경력을 의미하지 않습니다.
          </p>
        </section>

        <section className="nf-footer__block">
          <h2 className="nf-footer__title">데이터 안내</h2>
          <p className="nf-footer__note">
            치지직이 공개한 라이브·채널 정보를 읽기 전용으로 사용합니다. 공식 Open API 가 아니므로
            사전 공지 없이 형식이 바뀌거나 중단될 수 있습니다. 로그인 쿠키와 계정 정보는 읽지
            않습니다.
          </p>
          <p className="nf-footer__meta">{formatRelativeUpdate(lastUpdatedAt, now)}</p>
        </section>

        <section className="nf-footer__block">
          <h2 className="nf-footer__title">비제휴 고지</h2>
          <p className="nf-footer__note">
            {EXTENSION_NAME}는 NAVER 또는 CHZZK의 공식 서비스가 아닌 독립적인 브라우저 확장
            프로그램입니다.
          </p>
          <p className="nf-footer__meta">버전 {EXTENSION_VERSION}</p>
        </section>
      </div>
    </footer>
  );
}
