// 共享 UI 小组件与格式化工具。

import {
  BatchStatus,
  RULE_TEXT,
  RuleCode,
  SlideStatus,
  VersionStatus,
  batchStatusLabel,
  slideStatusLabel,
  versionStatusLabel,
} from "./domain";

export function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function toLocalInputValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

export function SlideStatusBadge({ status }: { status: SlideStatus }) {
  return (
    <span className={`badge slide-${status}`}>{slideStatusLabel(status)}</span>
  );
}

export function BatchStatusBadge({ status }: { status: BatchStatus }) {
  return (
    <span className={`badge batch-${status}`}>{batchStatusLabel(status)}</span>
  );
}

export function VersionStatusBadge({ status }: { status: VersionStatus }) {
  return (
    <span className={`badge version-${status}`}>{versionStatusLabel(status)}</span>
  );
}

export function RuleTag({ rule }: { rule: RuleCode }) {
  return (
    <span className="rule-tag" title={RULE_TEXT[rule]}>
      {rule} {RULE_TEXT[rule]}
    </span>
  );
}
