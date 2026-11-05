/* eslint-disable @next/next/no-html-link-for-pages -- Full-document navigation keeps the public entry and sign-in flow consistent. */
import { ArrowRight, ArrowUpRight, CalendarDays, CalendarHeart, Check, ChevronDown, ChevronLeft, ChevronRight, Download, Heart, Link2, List, MapPin, Plus, Repeat2, Search, Settings2, Users } from "lucide-react";

type LandingPageProps = { signedIn?: boolean };

const exampleEvents: Record<number, { title: string; who: "me" | "partner" | "both"; time?: string }[]> = {
  3: [{ title: "오전 집중 시간", who: "me", time: "09:00" }],
  4: [{ title: "필라테스", who: "partner", time: "18:30" }],
  5: [{ title: "장보기", who: "both", time: "18:00" }, { title: "둘이서 저녁", who: "both", time: "19:30" }],
  7: [{ title: "주말 브런치", who: "both", time: "11:00" }],
  9: [{ title: "프로젝트 미팅", who: "me", time: "10:00" }],
  10: [{ title: "친구와 저녁", who: "partner", time: "19:00" }],
  12: [{ title: "영화 보는 날", who: "both", time: "20:00" }],
  14: [{ title: "부모님과 점심", who: "both", time: "12:00" }],
  16: [{ title: "건강검진", who: "me", time: "09:30" }],
  18: [{ title: "함께 걷는 저녁", who: "both", time: "19:00" }],
  20: [{ title: "필라테스", who: "partner", time: "18:30" }],
  22: [{ title: "우리의 기념일", who: "both" }],
  26: [{ title: "새로운 맛집", who: "both", time: "19:00" }],
  28: [{ title: "느긋한 토요일", who: "both" }],
};

const questions = [
  { question: "어떤 계정으로 시작하나요?", answer: "이메일과 비밀번호로 가입하거나 Google 계정으로 간편하게 시작해요. 이메일로 가입하면 인증 메일을 확인해 주세요. 두 사람은 각자의 계정으로 로그인한 뒤, 초대 링크로 같은 캘린더에 연결하면 돼요." },
  { question: "‘나’와 ‘짝꿍’의 일정은 서로에게 보이나요?", answer: "네. ‘나’, ‘짝꿍’, ‘함께’는 일정을 구분하는 세 가지 표시예요. 캘린더에 저장한 모든 일정은 두 사람이 함께 보고 수정할 수 있어요. 설정에서 두 사람의 이름도 바꿀 수 있어요." },
  { question: "짝꿍은 어떻게 초대하나요?", answer: "캘린더를 만든 다음, 설정에서 초대 링크를 만들어 짝꿍에게 보내주세요. 짝꿍이 자신의 계정으로 로그인하고 연결을 마치면 같은 공간을 사용해요. 초대 링크는 7일 동안 유효하며, 한 번 연결할 수 있어요." },
  { question: "앱을 따로 설치해야 하나요?", answer: "휴대폰이나 컴퓨터의 브라우저에서 바로 사용할 수 있어요. 같은 계정으로 로그인하면 저장한 캘린더를 이어서 볼 수 있어요. 일정 시간은 한국 시간(서울)을 기준으로 표시해요." },
  { question: "다른 캘린더로 일정을 옮길 수 있나요?", answer: "캘린더의 내보내기 버튼을 누르면 현재 보고 있는 일정을 .ics 파일로 저장할 수 있어요. 이 파일을 지원하는 다른 캘린더에 가져오면 돼요. 외부 캘린더와 자동으로 동기화되는 기능은 제공하지 않아요." },
];

function Logo({ light = false }: { light?: boolean }) {
  return <span className={`lp-logo ${light ? "lp-logo-light" : ""}`}><span className="lp-logo-symbol" aria-hidden="true"><i /><i /></span><span className="lp-logo-word">sai<span>.</span></span><span className="lp-logo-korean">사이</span></span>;
}

function MobileCalendarPreview() {
  return <div className="lp-mobile-preview" aria-hidden="true">
    <div className="lp-mobile-preview-header"><div><span className="lp-mobile-preview-logo">sai<span>.</span></span><strong>우리의 캘린더</strong></div><span className="lp-mobile-preview-badge">예시 화면</span></div>
    <div className="lp-mobile-preview-search"><Search size={14} /><span>일정 검색</span></div>
    <div className="lp-mobile-preview-toolbar"><strong>2026년 11월</strong><span><ChevronLeft size={15} /><i>오늘</i><ChevronRight size={15} /></span></div>
    <div className="lp-mobile-preview-legend"><span className="lp-me"><i />나</span><span className="lp-partner"><i />짝꿍</span><span className="lp-both"><i />함께</span><small>각자의 하루, 함께하는 시간.</small></div>
    <div className="lp-mobile-preview-weekdays">{"일월화수목금토".split("").map(day => <span key={day}>{day}</span>)}</div>
    <div className="lp-mobile-preview-month">{Array.from({ length: 35 }, (_, index) => {
      const day = index + 1;
      const outside = day > 30;
      return <div key={day} className={`lp-mobile-preview-cell ${day === 5 ? "is-selected" : ""} ${outside ? "is-outside" : ""}`}><span className="lp-mobile-preview-day">{outside ? day - 30 : day}</span>{(exampleEvents[day] || []).slice(0, 2).map(event => <span key={event.title} className={`lp-mobile-preview-event lp-${event.who}`}><span>{event.title}</span></span>)}</div>;
    })}</div>
    <div className="lp-mobile-preview-nav"><span className="is-active"><CalendarDays size={18} />달력</span><span><List size={18} />목록</span><span><i><Plus size={19} /></i>일정 추가</span><span><Users size={18} />짝꿍 초대</span></div>
  </div>;
}

function CalendarPreview() {
  return <figure className="lp-preview" aria-label="사이의 월간 캘린더 예시. 나, 짝꿍, 함께 일정을 서로 다른 색으로 한눈에 확인할 수 있습니다.">
    <div className="lp-preview-wash" aria-hidden="true" />
    <div className="lp-preview-decoration" aria-hidden="true"><svg viewBox="0 0 360 180" fill="none"><path d="M12 150C91 188 60 31 140 53C203 70 177 169 259 142C309 125 285 48 347 10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /><path d="m337 12 11-3-2 12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></svg></div>
    <div className="lp-calendar-window" aria-hidden="true">
      <div className="lp-window-bar"><div><i /><i /><i /></div><span>사이 · 우리의 캘린더</span><span className="lp-window-mark"><Heart size={10} /> MADE FOR TWO</span></div>
      <div className="lp-mock-shell"><div className="lp-mock-sidebar"><span className="lp-mock-wordmark">sai<span>.</span></span><div className="lp-mock-create"><Plus size={11} />일정 만들기</div><div className="lp-mock-nav"><span className="active"><CalendarDays size={12} />우리 캘린더</span><span><List size={12} />일정 모아보기</span></div><span className="lp-mock-section-label">우리의 캘린더</span><div className="lp-mock-owners"><span className="lp-me"><Check size={10} />나</span><span className="lp-partner"><Check size={10} />짝꿍</span><span className="lp-both"><Check size={10} />함께<Heart size={9} /></span></div><div className="lp-mock-side-bottom"><Users size={12} />둘만의 작은 공간<span><Settings2 size={11} />캘린더 설정</span></div></div>
        <div className="lp-mock-main"><div className="lp-mock-top"><div><strong>우리의 캘린더</strong><span>각자의 하루, 함께하는 시간.</span></div><div className="lp-mock-avatars"><span>나</span><span>짝</span></div></div><div className="lp-mock-toolbar"><strong>2026년 11월</strong><span><ChevronLeft size={11} /><ChevronRight size={11} /><i>오늘</i></span><div><b>월</b>주<span>목록</span></div></div><div className="lp-mock-weekdays">{"일월화수목금토".split("").map(day => <span key={day}>{day}</span>)}</div><div className="lp-mock-month">{Array.from({ length: 35 }, (_, index) => { const day = index + 1; const outside = day > 30; return <div key={day} className={`${day === 5 ? "lp-mock-selected" : ""} ${outside ? "lp-mock-outside" : ""}`}><span className="lp-mock-day">{outside ? day - 30 : day}</span>{(exampleEvents[day] || []).map(event => <div key={event.title} className={`lp-mock-event lp-${event.who}`}><i />{event.time ? <small>{event.time}</small> : null}<span>{event.title}</span></div>)}</div>; })}</div><div className="lp-mock-foot"><Heart size={9} />일상을 나누는 가장 다정한 방법<span>한국 시간 · 서울</span></div></div>
      </div>
    </div>
    <MobileCalendarPreview />
    <div className="lp-preview-note" aria-hidden="true"><span className="lp-preview-note-icon"><Heart size={20} strokeWidth={1.5} /></span><div><span>우리의 기념일</span><strong>잊지 않고, 다정하게.</strong></div><b>D−17</b></div>
    <figcaption><span className="lp-example-dot" />예시 화면 · 시작하면 둘만의 빈 캘린더가 열려요.</figcaption>
  </figure>;
}

export default function LandingPage({ signedIn = false }: LandingPageProps) {
  const startHref = signedIn ? "/app" : "/start";
  const startLabel = signedIn ? "내 캘린더" : "로그인";
  const navHref = signedIn ? "/app" : "/login";
  return <div className="sai-landing">
    <a className="lp-skip" href="#lp-main">본문으로 바로 가기</a>
    <header className="lp-header"><a href="/" className="lp-brand-link" aria-label="사이 홈"><Logo /></a><nav aria-label="사이트 메뉴"><a href="#lp-features">사이가 좋은 이유</a><a href="#lp-how">시작하는 방법</a><a href="#lp-faq">자주 묻는 질문</a></nav><a className="lp-nav-cta" href={navHref} target="_top">{startLabel}<ArrowUpRight size={15} /></a></header>

    <main id="lp-main">
      <section className="lp-hero lp-container" aria-labelledby="lp-hero-title"><div className="lp-hero-copy"><p className="lp-kicker"><span className="lp-kicker-circles" aria-hidden="true"><i /><i /></span>딱 두 사람을 위한 캘린더</p><h1 id="lp-hero-title">각자의 하루가,<br /><em>우리의 시간</em>이<br className="lp-title-break" /> 되는 곳.</h1><p className="lp-hero-description">“우리 주말에 뭐 하지?”<br />일정을 나누면, 함께할 시간이 보여요.<br />둘만의 캘린더, 사이에서.</p><div className="lp-hero-actions"><a className="lp-button lp-button-primary" href={startHref} target="_top">{signedIn ? "우리 캘린더 열기" : "우리 캘린더 시작하기"}<ArrowUpRight size={17} /></a><a className="lp-button lp-button-text" href="/app?demo=1">먼저 둘러보기<ArrowRight size={16} /></a></div><p className="lp-hero-footnote">설치 없이 브라우저에서<span>·</span>이메일 또는 Google로 시작</p></div><CalendarPreview /></section>

      <section className="lp-intro lp-container" id="lp-features" aria-labelledby="lp-intro-title"><div className="lp-section-caption"><span>MORE TOGETHER</span><i />둘의 일상에, 자연스럽게</div><div className="lp-intro-layout"><h2 id="lp-intro-title">같이 산다고,<br />일정을 다 아는 건<br />아니니까.</h2><div className="lp-intro-body"><p>바쁜 평일에는 각자의 일상을.<br />기다리던 주말에는 함께할 약속을.</p><p>메시지 사이에서 다시 찾지 않아도,<br />하나의 캘린더에 담으면 서로의 하루가 보이죠.</p><a className="lp-inline-link" href="/app?demo=1">어떤 느낌인지 살펴보기<ArrowRight size={16} /></a></div><div className="lp-color-story" aria-label="나의 일정은 보라색, 짝꿍의 일정은 코랄색, 함께하는 일정은 초록색"><div className="lp-color-strip lp-me"><span>나의 하루</span><i /><strong>집중하는 시간</strong></div><div className="lp-color-strip lp-partner"><span>짝꿍의 하루</span><i /><strong>좋아하는 운동</strong></div><div className="lp-color-strip lp-both"><span>우리의 시간</span><Heart size={16} /><strong>같이 걷는 저녁</strong></div><span className="lp-color-story-caption">따로, 또 같이. 한눈에.</span></div></div></section>

      <section className="lp-day-story" aria-labelledby="lp-day-title"><div className="lp-container lp-day-layout"><div className="lp-day-visual"><div className="lp-day-visual-top"><span>THURSDAY, TOGETHER</span><span>예시 일정</span></div><div className="lp-day-date"><span>11.05</span><div>목요일<strong>오늘의 작은 약속</strong></div></div><div className="lp-day-row lp-me"><span className="lp-day-time">09:00<i /></span><div><span className="lp-day-owner">나 · 업무</span><h3>오전은 집중하는 시간</h3><p>각자의 일을 응원하는 하루</p></div></div><div className="lp-day-row lp-partner"><span className="lp-day-time">18:00<i /></span><div><span className="lp-day-owner">짝꿍 · 일상</span><h3>운동하고 올게요</h3><p>서로의 하루를 미리 알고</p></div></div><div className="lp-day-row lp-both"><span className="lp-day-time">19:30<i /></span><div><span className="lp-day-owner">함께 · 데이트</span><h3>저녁은 같이 먹어요</h3><p><MapPin size={12} />우리가 좋아하는 그 집</p></div><span className="lp-day-heart"><Heart size={22} strokeWidth={1.3} /></span></div><div className="lp-day-visual-bottom"><span className="lp-me"><i />나</span><span className="lp-partner"><i />짝꿍</span><span className="lp-both"><i />함께</span></div></div><div className="lp-day-copy"><p className="lp-section-eyebrow">LESS ASKING. MORE SHARING.</p><h2 id="lp-day-title">“오늘 몇 시에 와?”<br />대신,<br /><em>“저녁 같이 먹자.”</em></h2><p>나, 짝꿍, 함께.<br />세 가지 색으로 하루의 흐름을 구분해요.<br />바쁜 날도, 여유로운 날도 한눈에 보이니까<br />함께할 시간을 찾기 쉬워져요.</p><div className="lp-privacy-note"><Users size={16} /><span>모든 일정은 우리 둘에게 보여요.</span></div></div></div></section>

      <section className="lp-details lp-container" aria-labelledby="lp-details-title"><div className="lp-details-heading"><div><p className="lp-section-eyebrow">SIMPLE, BUT THOUGHTFUL</p><h2 id="lp-details-title">작은 약속도,<br />잘 챙길 수 있도록.</h2></div><p>복잡한 기능을 배우는 대신,<br />우리의 하루에 바로 써보세요.</p></div><div className="lp-detail-grid"><article><span className="lp-feature-number">01 / OUR RHYTHM</span><div className="lp-feature-icon"><CalendarDays size={24} strokeWidth={1.4} /></div><h3>한 달의 계획부터<br />오늘의 약속까지</h3><p>월·주·목록 보기로 원하는 만큼 살펴보고,<br className="lp-wide-only" /> 장소와 메모까지 한곳에 남겨요.</p><div className="lp-view-sample" aria-hidden="true"><span>월</span><span>주</span><span>목록</span><i /><CalendarDays size={16} /></div></article><article><span className="lp-feature-number">02 / LITTLE ROUTINES</span><div className="lp-feature-icon lp-icon-coral"><Repeat2 size={24} strokeWidth={1.4} /></div><h3>매주 돌아오는 일상,<br />매년 소중한 기념일</h3><p>반복 일정은 한 번에 설정하고,<br className="lp-wide-only" /> 다가오는 기념일은 D-day로 챙겨요.</p><div className="lp-repeat-sample" aria-hidden="true"><span>매주 금요일</span><Repeat2 size={14} /><span>우리의 저녁</span></div></article><article><span className="lp-feature-number">03 / EASY TO FIND</span><div className="lp-feature-icon lp-icon-mint"><Search size={24} strokeWidth={1.4} /></div><h3>찾고 싶을 때 쉽게,<br />옮기고 싶을 때 가볍게</h3><p>제목·장소·메모로 일정을 검색하고,<br className="lp-wide-only" /> 보고 있는 일정을 .ics로 내보내요.</p><div className="lp-search-sample" aria-hidden="true"><Search size={14} /><span>우리의 약속</span><Download size={14} /></div></article></div></section>

      <section className="lp-how" id="lp-how" aria-labelledby="lp-how-title"><div className="lp-container"><div className="lp-how-heading"><p className="lp-section-eyebrow">JUST THE TWO OF US</p><h2 id="lp-how-title">함께 시작하는 건, 간단해요.</h2><p>캘린더 하나, 초대 링크 하나면 충분해요.</p></div><ol className="lp-steps"><li><span className="lp-step-number">01</span><div className="lp-step-line" /><div className="lp-step-icon"><CalendarHeart size={27} strokeWidth={1.3} /></div><h3>우리 캘린더를 만들어요</h3><p>이메일 또는 Google로 가입하고<br />둘만의 공간에 이름을 붙여주세요.</p></li><li><span className="lp-step-number">02</span><div className="lp-step-line" /><div className="lp-step-icon"><Link2 size={27} strokeWidth={1.3} /></div><h3>짝꿍에게 링크를 보내요</h3><p>설정에서 초대 링크를 만들고,<br />짝꿍은 자신의 계정으로 연결해요.</p></li><li><span className="lp-step-number">03</span><div className="lp-step-icon"><Heart size={27} strokeWidth={1.3} /></div><h3>작은 약속부터 남겨요</h3><p>“토요일 브런치 어때?”<br />함께할 첫 일정을 더해보세요.</p></li></ol><a className="lp-inline-link" href="/app?setup=join">이미 초대받았나요?<ArrowRight size={16} /></a></div></section>

      <section className="lp-faq lp-container" id="lp-faq" aria-labelledby="lp-faq-title"><div className="lp-faq-intro"><p className="lp-section-eyebrow">A FEW THINGS TO KNOW</p><h2 id="lp-faq-title">궁금한 게<br />있나요?</h2><p>시작하기 전,<br />이것만 알아두세요.</p></div><div className="lp-faq-list">{questions.map(({ question, answer }, index) => <details key={question}><summary><span className="lp-question-number">0{index + 1}</span><span>{question}</span><ChevronDown size={18} /></summary><p>{answer}</p></details>)}</div></section>

      <section className="lp-final" aria-labelledby="lp-final-title"><div className="lp-container lp-final-layout"><div><p className="lp-section-eyebrow">A LITTLE CLOSER, EVERY DAY.</p><h2 id="lp-final-title">다음 약속은,<br />사이에서 만나요.</h2><p>각자의 하루를 나누고, 함께할 시간을 만들어가요.</p><a className="lp-button lp-button-light" href={startHref} target="_top">{signedIn ? "내 캘린더로 가기" : "우리 캘린더 시작하기"}<ArrowUpRight size={17} /></a><a className="lp-final-demo" href="/app?demo=1">먼저 둘러볼게요<ArrowRight size={14} /></a></div><div className="lp-final-circles" aria-hidden="true"><i /><i /><span>you<br /><em>&</em> me.</span><Heart size={27} strokeWidth={1.1} /></div></div></section>
    </main>

    <footer className="lp-footer lp-container"><div><a href="/" aria-label="사이 홈"><Logo /></a><p>각자의 하루, 함께하는 시간.</p></div><nav aria-label="하단 메뉴"><a href="/app?demo=1">둘러보기</a><a href="/app?setup=join">초대받아 연결하기</a><a href="#lp-faq">자주 묻는 질문</a></nav><span>© 2026 SAI. Made for two.</span></footer>
  </div>;
}
