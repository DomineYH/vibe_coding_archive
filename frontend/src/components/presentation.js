export function formatCheckedAt(checkedAt, serverTime) {
  if (!checkedAt) return "검사 기록 없음";
  const format = (value) => {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(value));
    return Object.fromEntries(
      parts.map(({ type, value: part }) => [type, part]),
    );
  };
  const checked = format(checkedAt);
  const current = format(serverTime);
  const time = `${checked.hour}:${checked.minute}`;
  if (
    checked.year === current.year &&
    checked.month === current.month &&
    checked.day === current.day
  )
    return `오늘 ${time}`;
  return `${checked.year}.${Number(checked.month)}.${Number(checked.day)}. ${time}`;
}

export function formatDate(value) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const date = Object.fromEntries(
    parts.map(({ type, value: part }) => [type, part]),
  );
  return `${date.year}-${date.month}-${date.day}`;
}
