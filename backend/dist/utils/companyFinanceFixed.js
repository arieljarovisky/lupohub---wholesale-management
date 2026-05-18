"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.countCalendarMonthsInRange = countCalendarMonthsInRange;
exports.fixedExpenseMonthsInRange = fixedExpenseMonthsInRange;
exports.round2 = round2;
/** Clave año-mes para comparar meses calendario (m = 0-11). */
function monthKey(year, monthIndex) {
    return year * 12 + monthIndex;
}
function parseYmd(ymd) {
    const [y, m] = ymd.slice(0, 10).split('-').map(Number);
    return { y, m };
}
/** Cantidad de meses calendario completos que intersectan el rango [from, to]. */
function countCalendarMonthsInRange(from, to) {
    const a = parseYmd(from);
    const b = parseYmd(to);
    if (monthKey(b.y, b.m - 1) < monthKey(a.y, a.m - 1))
        return 0;
    return monthKey(b.y, b.m - 1) - monthKey(a.y, a.m - 1) + 1;
}
/** Meses aplicables de un gasto fijo dentro del rango del resumen. */
function fixedExpenseMonthsInRange(from, to, startsFrom, endsAt) {
    const rangeStart = parseYmd(from);
    const rangeEnd = parseYmd(to);
    let start = monthKey(rangeStart.y, rangeStart.m - 1);
    let end = monthKey(rangeEnd.y, rangeEnd.m - 1);
    if (startsFrom) {
        const s = parseYmd(startsFrom);
        start = Math.max(start, monthKey(s.y, s.m - 1));
    }
    if (endsAt) {
        const e = parseYmd(endsAt);
        end = Math.min(end, monthKey(e.y, e.m - 1));
    }
    return Math.max(0, end - start + 1);
}
function round2(n) {
    return Math.round(n * 100) / 100;
}
