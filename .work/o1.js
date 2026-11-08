function isQuietHour(hour, from, to) {
  if (from <= to) {
    return hour >= from && hour < to;
  } else {
    return hour >= from || hour < to;
  }
}
