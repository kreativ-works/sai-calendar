import type { CalendarState } from "../domain/calendar.ts";
import { addDays, monthEnd, monthStart } from "./calendar-view.ts";

export type CalendarBootstrap = { today: string; from: string; to: string; state: CalendarState };

export function initialCalendarRange(today: string): { from: string; to: string } {
  return { from: addDays(monthStart(today), -7), to: addDays(monthEnd(today), 7) };
}

export function matchesCalendarBootstrap(value: Pick<CalendarBootstrap, "from" | "to"> | null | undefined, from: string, to: string): boolean {
  return !!value && value.from === from && value.to === to;
}
