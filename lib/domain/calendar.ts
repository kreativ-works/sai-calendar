export type MemberSlot = "a" | "b";
export type OwnerScope = MemberSlot | "both";
export type EventCategory = "life" | "date" | "family" | "work" | "anniversary";
export type RepeatRule = "none" | "weekly" | "monthly" | "yearly";

export interface CalendarEventInput {
  title: string;
  startDate: string;
  endDate: string;
  startTime: string | null;
  endTime: string | null;
  allDay: boolean;
  ownerScope: OwnerScope;
  category: EventCategory;
  location: string;
  note: string;
  repeat: RepeatRule;
  repeatUntil: string | null;
}

export interface CalendarEvent extends CalendarEventInput {
  id: string;
  occurrenceId: string;
  originalStartDate: string;
  originalEndDate: string;
  revision: number;
}

export interface CalendarMember {
  slot: MemberSlot;
  name: string;
  connected: boolean;
  userId?: string;
}

export interface HouseholdProfile {
  id: string;
  name: string;
  timeZone: "Asia/Seoul";
  anniversary: string | null;
  revision: number;
}

export interface CalendarState {
  user: { id: string; name: string; email: string };
  viewerSlot: MemberSlot | null;
  household: HouseholdProfile | null;
  members: CalendarMember[];
  events: CalendarEvent[];
  invite: { expiresAt: string } | null;
}

export interface HouseholdInput {
  name: string;
  aName: string;
  bName: string;
  anniversary?: string | null;
}

export class CalendarError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "CalendarError";
    this.status = status;
    this.code = code;
  }
}

const DAY = 86_400_000;
export function dateNumber(value: string): number {
  return Date.parse(`${value}T00:00:00.000Z`);
}

export function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = dateNumber(value);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value && value >= "1970-01-01" && value <= "2100-12-31";
}

export function shiftDate(value: string, days: number): string {
  return new Date(dateNumber(value) + days * DAY).toISOString().slice(0, 10);
}

export function dayDifference(start: string, end: string): number {
  return Math.round((dateNumber(end) - dateNumber(start)) / DAY);
}

function invalid(message: string): never {
  throw new CalendarError(422, "INVALID_INPUT", message);
}

export function boundedText(value: unknown, label: string, max: number, required = false): string {
  if (typeof value !== "string") invalid(`${label}을(를) 확인해 주세요.`);
  const text = value.trim();
  if ((required && !text) || text.length > max) invalid(`${label}은(는) ${required ? "1~" : "최대 "}${max}자까지 입력해 주세요.`);
  return text;
}

export function parseHousehold(value: unknown): Required<HouseholdInput> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("캘린더 정보를 확인해 주세요.");
  const data = value as Record<string, unknown>;
  const anniversary = data.anniversary == null || data.anniversary === "" ? null : data.anniversary;
  if (anniversary !== null && !validDate(anniversary)) invalid("기념일 날짜를 확인해 주세요.");
  return {
    name: boundedText(data.name, "캘린더 이름", 50, true),
    aName: boundedText(data.aName, "첫 번째 이름", 24, true),
    bName: boundedText(data.bName, "두 번째 이름", 24, true),
    anniversary,
  };
}

export function parseEvent(value: unknown): CalendarEventInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("일정 정보를 확인해 주세요.");
  const data = value as Record<string, unknown>;
  const startDate = data.startDate;
  const endDate = data.endDate;
  if (!validDate(startDate) || !validDate(endDate) || endDate < startDate || dayDifference(startDate, endDate) > 366) invalid("시작일과 종료일을 확인해 주세요. 일정은 최대 366일까지 설정할 수 있어요.");
  if (typeof data.allDay !== "boolean") invalid("종일 여부를 확인해 주세요.");
  let startTime: string | null = null;
  let endTime: string | null = null;
  if (!data.allDay) {
    const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (typeof data.startTime !== "string" || typeof data.endTime !== "string" || !timePattern.test(data.startTime) || !timePattern.test(data.endTime)) invalid("시작 시간과 종료 시간을 확인해 주세요.");
    startTime = data.startTime;
    endTime = data.endTime;
    if (`${endDate}T${endTime}` <= `${startDate}T${startTime}`) invalid("종료 시간은 시작 시간보다 늦어야 해요.");
  }
  if (typeof data.ownerScope !== "string" || !["a", "b", "both"].includes(data.ownerScope)) invalid("일정의 주인공을 선택해 주세요.");
  if (typeof data.category !== "string" || !["life", "date", "family", "work", "anniversary"].includes(data.category)) invalid("일정 카테고리를 선택해 주세요.");
  const repeat = data.repeat ?? "none";
  if (typeof repeat !== "string" || !["none", "weekly", "monthly", "yearly"].includes(repeat)) invalid("반복 방식을 확인해 주세요.");
  const repeatUntil = repeat === "none" || data.repeatUntil == null || data.repeatUntil === "" ? null : data.repeatUntil;
  if (repeatUntil !== null && (!validDate(repeatUntil) || repeatUntil < startDate)) invalid("반복 종료일은 시작일 이후로 선택해 주세요.");
  return {
    title: boundedText(data.title, "일정 이름", 100, true),
    startDate, endDate, startTime, endTime, allDay: data.allDay,
    ownerScope: data.ownerScope as OwnerScope,
    category: data.category as EventCategory,
    location: boundedText(data.location ?? "", "장소", 200),
    note: boundedText(data.note ?? "", "메모", 2000),
    repeat: repeat as RepeatRule,
    repeatUntil,
  };
}

export function parseRevision(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) invalid("일정 버전을 확인해 주세요. 새로고침 후 다시 시도해 주세요.");
  return value;
}

export function parseRange(from: unknown, to: unknown): { from: string; to: string } {
  if (!validDate(from) || !validDate(to) || to < from || dayDifference(from, to) > 400) invalid("조회 기간은 올바른 날짜로 최대 400일까지 선택해 주세요.");
  return { from, to };
}

export type StoredEvent = CalendarEventInput & { id: string; revision: number };

/** Dates are inclusive for all-day events; timed events use Korea wall time. */
export function expandEvents(events: StoredEvent[], from: string, to: string): CalendarEvent[] {
  parseRange(from, to);
  const result: CalendarEvent[] = [];
  for (const event of events) {
    const span = dayDifference(event.startDate, event.endDate);
    const earliest = shiftDate(from, -span);
    const push = (start: string) => {
      if (start < event.startDate || start > to || (event.repeatUntil && start > event.repeatUntil)) return;
      const end = shiftDate(start, span);
      if (end < from) return;
      result.push({ ...event, startDate: start, endDate: end, originalStartDate: event.startDate, originalEndDate: event.endDate, occurrenceId: `${event.id}:${start}` });
      if (result.length > 10_000) throw new CalendarError(422, "TOO_MANY_OCCURRENCES", "조회 기간을 줄여 주세요.");
    };
    if (event.repeat === "none") {
      push(event.startDate);
    } else if (event.repeat === "weekly") {
      const skipped = Math.max(0, Math.floor(dayDifference(event.startDate, earliest) / 7));
      for (let day = shiftDate(event.startDate, skipped * 7); day <= to; day = shiftDate(day, 7)) push(day);
    } else {
      const anchor = new Date(dateNumber(event.startDate));
      const lower = new Date(dateNumber(earliest));
      const upper = new Date(dateNumber(to));
      const targetDay = anchor.getUTCDate();
      const targetMonth = anchor.getUTCMonth();
      if (event.repeat === "monthly") {
        const first = Math.max(anchor.getUTCFullYear() * 12 + targetMonth, lower.getUTCFullYear() * 12 + lower.getUTCMonth());
        const last = upper.getUTCFullYear() * 12 + upper.getUTCMonth();
        for (let month = first; month <= last; month++) {
          const date = new Date(Date.UTC(Math.floor(month / 12), month % 12, targetDay));
          if (date.getUTCDate() === targetDay) push(date.toISOString().slice(0, 10));
        }
      } else {
        for (let year = Math.max(anchor.getUTCFullYear(), lower.getUTCFullYear()); year <= upper.getUTCFullYear(); year++) {
          const date = new Date(Date.UTC(year, targetMonth, targetDay));
          if (date.getUTCDate() === targetDay && date.getUTCMonth() === targetMonth) push(date.toISOString().slice(0, 10));
        }
      }
    }
  }
  return result.sort((a, b) => `${a.startDate}${a.startTime ?? ""}`.localeCompare(`${b.startDate}${b.startTime ?? ""}`) || a.id.localeCompare(b.id));
}

export function eventsOverlap(a: CalendarEventInput, b: CalendarEventInput): boolean {
  if (a.ownerScope !== "both" && b.ownerScope !== "both" && a.ownerScope !== b.ownerScope) return false;
  const startA = `${a.startDate}T${a.allDay ? "00:00" : a.startTime}`;
  const endA = a.allDay ? `${shiftDate(a.endDate, 1)}T00:00` : `${a.endDate}T${a.endTime}`;
  const startB = `${b.startDate}T${b.allDay ? "00:00" : b.startTime}`;
  const endB = b.allDay ? `${shiftDate(b.endDate, 1)}T00:00` : `${b.endDate}T${b.endTime}`;
  return startA < endB && startB < endA;
}
