import type { ReactNode } from "react";
import { ArrowUpRight, CalendarDays, ClipboardList, LogOut, ShieldCheck } from "lucide-react";

type Props = { name: string; email: string; children: ReactNode };

export default function AdminShell({ name, email, children }: Props) {
  const displayName = name.trim() || "운영자";
  const initial = Array.from(displayName)[0];

  return <div className="admin-shell">
    <a className="admin-skip-link" href="#admin-content">관리 내용으로 바로 가기</a>
    <header className="admin-header">
      <div className="admin-header-inner">
        <div className="admin-masthead">
          <a className="admin-brand" href="/admin/backlog" aria-label="사이 관리자 페이지">
            <span className="admin-brand-mark">sai<span>.</span></span>
            <span className="admin-brand-copy"><strong>사이 어드민</strong><small>ADMIN WORKSPACE</small></span>
          </a>
          <div className="admin-header-actions">
            <a className="admin-calendar-link" href="/app"><CalendarDays size={16} aria-hidden="true" /><span>캘린더로</span><ArrowUpRight size={14} aria-hidden="true" /></a>
            <a className="admin-logout-link" href="/logout"><LogOut size={15} aria-hidden="true" /><span>로그아웃</span></a>
          </div>
        </div>
        <div className="admin-workspace-bar">
          <nav className="admin-navigation" aria-label="관리 메뉴">
            <a href="/admin/backlog" aria-current="page"><ClipboardList size={17} aria-hidden="true" /><span>피드백 백로그</span></a>
          </nav>
          <div className="admin-identity" aria-label="현재 로그인한 운영자">
            <span className="admin-avatar" aria-hidden="true">{initial}</span>
            <div className="admin-identity-copy"><div><strong title={displayName}>{displayName}</strong><span className="admin-role"><ShieldCheck size={11} aria-hidden="true" />운영자</span></div><span className="admin-identity-email" title={email}>{email}</span></div>
          </div>
        </div>
      </div>
    </header>
    <div className="admin-content" id="admin-content" tabIndex={-1}>{children}</div>
  </div>;
}
