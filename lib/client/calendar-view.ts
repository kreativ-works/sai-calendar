import type { CalendarEvent } from "@/lib/domain/calendar";

export const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
export const FULL_WEEKDAYS = ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"];
export const CATEGORY_NAMES = { life: "일상", date: "데이트", family: "가족", work: "업무", anniversary: "기념일" } as const;
export const REPEAT_NAMES = { none: "반복 안 함", weekly: "매주", monthly: "매월", yearly: "매년" } as const;

export function todayInSeoul() {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  return `${p.find(x => x.type === "year")!.value}-${p.find(x => x.type === "month")!.value}-${p.find(x => x.type === "day")!.value}`;
}

export function dateValue(date: string) { return new Date(`${date}T12:00:00Z`); }
export function isoDate(date: Date) { return date.toISOString().slice(0, 10); }
export function addDays(date: string, amount: number) { const value = dateValue(date); value.setUTCDate(value.getUTCDate() + amount); return isoDate(value); }
export function monthStart(date: string) { return `${date.slice(0, 7)}-01`; }
export function monthEnd(date: string) { const value = dateValue(monthStart(date)); value.setUTCMonth(value.getUTCMonth() + 1); value.setUTCDate(0); return isoDate(value); }
export function shiftMonth(date: string, amount: number) { const value = dateValue(monthStart(date)); value.setUTCMonth(value.getUTCMonth() + amount); return isoDate(value); }
export function dayOfWeek(date: string) { return dateValue(date).getUTCDay(); }
export function dayNumber(date: string) { return Number(date.slice(8, 10)); }
export function monthLabel(date: string) { return `${Number(date.slice(0, 4))}년 ${Number(date.slice(5, 7))}월`; }
export function shortDate(date: string) { return `${Number(date.slice(5, 7))}월 ${dayNumber(date)}일`; }
export function fullDate(date: string) { return `${Number(date.slice(0, 4))}년 ${shortDate(date)} ${FULL_WEEKDAYS[dayOfWeek(date)]}`; }
export function weekStart(date: string) { return addDays(date, -dayOfWeek(date)); }
export function monthCells(date: string) {
  const first = monthStart(date);
  const start = addDays(first, -dayOfWeek(first));
  const count = Math.ceil((dayOfWeek(first) + dayNumber(monthEnd(date))) / 7) * 7;
  return Array.from({ length: count }, (_, i) => addDays(start, i));
}
export function occursOn(event: CalendarEvent, date: string) { return event.startDate <= date && event.endDate >= date; }
export function sortEvents(events: CalendarEvent[]) {
  return [...events].sort((a, b) => a.startDate.localeCompare(b.startDate) || Number(b.allDay) - Number(a.allDay) || (a.startTime || "").localeCompare(b.startTime || "") || a.title.localeCompare(b.title, "ko"));
}
export function eventTime(event: CalendarEvent, date?: string) {
  if (event.allDay) return "하루 종일";
  if (date && event.startDate < date) return "이어서";
  return event.startTime || "";
}
export function eventRange(event: CalendarEvent) {
  if (event.startDate === event.endDate) return `${fullDate(event.startDate)}${event.allDay ? " · 하루 종일" : ` · ${event.startTime} — ${event.endTime}`}`;
  return `${shortDate(event.startDate)}${event.allDay ? "" : ` ${event.startTime}`} — ${shortDate(event.endDate)}${event.allDay ? " · 하루 종일" : ` ${event.endTime}`}`;
}
export function dayDistance(from: string, to: string) { return Math.round((dateValue(to).getTime() - dateValue(from).getTime()) / 86400000); }
export function escapeIcs(value: string) { return value.replace(/\\/g, "\\\\").replace(/\r\n|\r|\n/g, "\\n").replace(/;/g, "\\;").replace(/,/g, "\\,"); }
function foldIcsLine(value: string) {
  const encoder = new TextEncoder();
  let output = "", line = "", bytes = 0;
  for (const char of value) {
    const size = encoder.encode(char).length;
    if (bytes + size > 75) { output += line + "\r\n"; line = " "; bytes = 1; }
    line += char; bytes += size;
  }
  return output + line;
}
export function downloadCalendar(events: CalendarEvent[], name: string) {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//SAI//Couple Calendar//KO", "CALSCALE:GREGORIAN", `X-WR-CALNAME:${escapeIcs(name)}`, "X-WR-TIMEZONE:Asia/Seoul"];
  for (const event of events) {
    lines.push("BEGIN:VEVENT", `UID:${event.occurrenceId}@sai-calendar`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")}`, `SUMMARY:${escapeIcs(event.title)}`);
    if (event.allDay) lines.push(`DTSTART;VALUE=DATE:${event.startDate.replace(/-/g, "")}`, `DTEND;VALUE=DATE:${addDays(event.endDate, 1).replace(/-/g, "")}`);
    else {
      const instant = (date: string, time: string | null) => new Date(`${date}T${time || "00:00"}:00+09:00`).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
      lines.push(`DTSTART:${instant(event.startDate, event.startTime)}`, `DTEND:${instant(event.endDate, event.endTime)}`);
    }
    if (event.location) lines.push(`LOCATION:${escapeIcs(event.location)}`);
    if (event.note) lines.push(`DESCRIPTION:${escapeIcs(event.note)}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  const url = URL.createObjectURL(new Blob([lines.map(foldIcsLine).join("\r\n") + "\r\n"], { type: "text/calendar;charset=utf-8" }));
  const link = document.createElement("a"); link.href = url; link.download = `사이-${name}.ics`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
