import { shiftDate, validDate, type CalendarEventInput } from "../domain/calendar.ts";

/** Default timed events last one hour in the calendar's local wall time. */
export function defaultEventEnd(startDate: string, startTime: string): { endDate: string; endTime: string } | null {
  if (!validDate(startDate) || typeof startTime !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime)) return null;
  const minutes = Number(startTime.slice(0, 2)) * 60 + Number(startTime.slice(3)) + 60;
  const endDate = minutes >= 1_440 ? shiftDate(startDate, 1) : startDate;
  if (!validDate(endDate)) return null;
  const hour = Math.floor((minutes % 1_440) / 60).toString().padStart(2, "0");
  const minute = (minutes % 60).toString().padStart(2, "0");
  return { endDate, endTime: `${hour}:${minute}` };
}

export function withEventStartTime(input: CalendarEventInput, startTime: string, preserveEndDate = false): CalendarEventInput {
  const end = defaultEventEnd(input.startDate, startTime);
  if (!end) return { ...input, startTime };
  return {
    ...input, startTime, endTime: end.endTime,
    endDate: preserveEndDate && input.endDate > end.endDate ? input.endDate : end.endDate,
  };
}

export function automaticEndDate(input: CalendarEventInput): string {
  return validDate(input.startDate) && input.startTime && input.endTime && input.endTime < input.startTime
    ? shiftDate(input.startDate, 1)
    : input.startDate;
}

export function withEventEndTime(input: CalendarEventInput, endTime: string, preserveEndDate = false): CalendarEventInput {
  const next = { ...input, endTime };
  return preserveEndDate ? next : { ...next, endDate: automaticEndDate(next) };
}
