import { memo, useState } from "react";
import { formatElapsedSince } from "../../domain/date";
import type { StreamCandidate } from "../../domain/models";
import { THUMBNAIL_FALLBACK_SRC } from "../../shared/constants";
import { buildChannelUrl } from "../../shared/url";
import { ClockIcon, FollowerIcon, TagIcon, ViewerIcon } from "./icons";

/**
 * - 정보 우선순위: 제목 → 채널명 → 시청자 → 경과 시간 → 팔로워 → 카테고리
 * - 링크 주소는 응답이 아니라 코드에서 만든다. 외부 링크에 noopener/noreferrer 를 붙인다.
 * - 팔로워 미확인을 0명으로 표시하지 않는다.
 */

export interface LiveCardProps {
  readonly candidate: StreamCandidate;
  readonly now: number;
}

function followerLabel(candidate: StreamCandidate): string | null {
  switch (candidate.followerState) {
    case "ready":
      return candidate.followerCount === null
        ? null
        : `팔로워 ${candidate.followerCount.toLocaleString("ko-KR")}명`;
    case "loading":
      return "팔로워 확인 중";
    case "failed":
      return "팔로워 확인 실패";
    case "idle":
    default:
      return null;
  }
}

export const LiveCard = memo(function LiveCard({ candidate, now }: LiveCardProps) {
  const [thumbFailed, setThumbFailed] = useState(false);

  const href = buildChannelUrl(candidate.channelId);
  const thumbnail = thumbFailed || candidate.thumbnailUrl === null
    ? THUMBNAIL_FALLBACK_SRC
    : candidate.thumbnailUrl;
  const follower = followerLabel(candidate);
  const elapsed = formatElapsedSince(candidate.startedAtEpoch, now);

  const body = (
    <>
      <div className="nf-card__media">
        <img
          className="nf-card__thumb"
          src={thumbnail}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setThumbFailed(true)}
        />
        <div className="nf-card__overlay">
          <span className="nf-card__overlay-left">
            <span className="nf-badge nf-badge--live">LIVE</span>
          </span>
          <span className="nf-card__overlay-right">
            <span className="nf-metric">
              <ViewerIcon size={13} />
              {candidate.viewerCount.toLocaleString("ko-KR")}명
            </span>
            <span className="nf-metric">
              <ClockIcon size={13} />
              {elapsed}
            </span>
          </span>
        </div>
      </div>

      <div className="nf-card__body">
        <h3 className="nf-card__title">{candidate.liveTitle || "제목 없음"}</h3>

        <p className="nf-card__channel">
          {candidate.channelImageUrl ? (
            <img className="nf-card__avatar" src={candidate.channelImageUrl} alt="" loading="lazy" decoding="async" />
          ) : (
            <span className="nf-card__avatar-fallback" aria-hidden="true" />
          )}
          <span className="nf-card__name">{candidate.channelName || "이름 없는 채널"}</span>
          {candidate.verified ? <span className="nf-badge nf-badge--info">인증</span> : null}
        </p>

        <p className="nf-card__meta">
          {follower ? (
            <span className="nf-card__meta-item">
              <FollowerIcon size={13} />
              {follower}
            </span>
          ) : null}
          {candidate.categoryName ? (
            <span className="nf-card__meta-item">
              <TagIcon size={13} />
              {candidate.categoryName}
            </span>
          ) : null}
        </p>
      </div>
    </>
  );

  if (href === null) {
    // 채널 ID 형식이 어긋나면 링크를 만들지 않는다.
    return <article className="nf-card nf-card--static">{body}</article>;
  }

  return (
    <a
      className="nf-card"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${candidate.channelName} 방송 보기: ${candidate.liveTitle}`}
    >
      {body}
    </a>
  );
});
