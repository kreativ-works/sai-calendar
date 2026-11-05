import type { CalendarEvent } from "@/lib/domain/calendar";
import { addDays, monthStart, todayInSeoul } from "./calendar-view";

// These examples stay separate from the shared calendar and are never sent to its API.
export function createDemoEvents(anchor = todayInSeoul()): CalendarEvent[] {
  const first = monthStart(anchor);
  const d = (day: number) => addDays(first, day - 1);
  const examples: [number, string, "a" | "b" | "both", string | null, string | null, CalendarEvent["category"], string][] = [
    [2, "이번 주도 잘 부탁해", "both", null, null, "life", ""],
    [3, "오전 집중 시간", "a", "09:00", "11:00", "work", ""],
    [4, "필라테스", "b", "18:30", "19:30", "life", "동네 스튜디오"],
    [5, "장보기", "both", "18:00", "19:00", "life", "우리 동네 마트"],
    [5, "둘이서 저녁", "both", "19:30", "21:00", "date", "연남동, 좋아하는 그 집"],
    [7, "느긋한 주말 브런치", "both", "11:00", "12:30", "date", "햇살 좋은 카페"],
    [9, "프로젝트 미팅", "a", "10:00", "11:00", "work", ""],
    [10, "친구와 저녁 약속", "b", "19:00", "21:00", "life", ""],
    [12, "영화 보러 가는 날", "both", "20:00", "22:00", "date", "동네 영화관"],
    [14, "부모님과 점심", "both", "12:00", "14:00", "family", "부모님 댁"],
    [16, "건강검진 예약", "a", "09:30", "11:00", "life", ""],
    [18, "함께 걷는 저녁", "both", "19:00", "20:00", "date", "집 앞 산책로"],
    [20, "필라테스", "b", "18:30", "19:30", "life", "동네 스튜디오"],
    [22, "우리의 기념일", "both", null, null, "anniversary", ""],
    [24, "팀 워크숍", "a", "14:00", "17:00", "work", ""],
    [26, "새로운 맛집 가보기", "both", "19:00", "20:30", "date", "가보고 싶던 곳"],
    [28, "아무것도 안 하는 토요일", "both", null, null, "life", "우리 집"],
  ];
  return examples.map(([day, title, ownerScope, startTime, endTime, category, location], index) => ({ id: `demo-${index}`, occurrenceId: `demo-${index}:${d(day)}`, title, startDate: d(day), endDate: d(day), startTime, endTime, allDay: !startTime, ownerScope, category, location, note: category === "date" ? "서로의 하루를 이야기하며 천천히 보내요." : "", repeat: "none", repeatUntil: null, revision: 1, originalStartDate: d(day), originalEndDate: d(day) }));
}
