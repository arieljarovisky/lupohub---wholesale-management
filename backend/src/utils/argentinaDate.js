"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.todayYmdArgentina = todayYmdArgentina;
exports.currentMonthNameEs = currentMonthNameEs;
exports.nowMysqlArgentina = nowMysqlArgentina;
const AR_TZ = 'America/Argentina/Buenos_Aires';
const MONTHS_ES = [
    'enero',
    'febrero',
    'marzo',
    'abril',
    'mayo',
    'junio',
    'julio',
    'agosto',
    'septiembre',
    'octubre',
    'noviembre',
    'diciembre',
];
/** Fecha local Argentina YYYY-MM-DD (emisión AFIP / “hoy”). */
function todayYmdArgentina() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: AR_TZ }).format(new Date());
}
/** Nombre del mes actual en español (hora Argentina), p. ej. «agosto». */
function currentMonthNameEs() {
    var _a;
    const mm = Number(todayYmdArgentina().slice(5, 7));
    return (_a = MONTHS_ES[mm - 1]) !== null && _a !== void 0 ? _a : '';
}
/** Timestamp MySQL `YYYY-MM-DD HH:mm:ss` en hora Argentina. */
function nowMysqlArgentina() {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: AR_TZ,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    }).formatToParts(new Date());
    const get = (t) => { var _a, _b; return (_b = (_a = parts.find((p) => p.type === t)) === null || _a === void 0 ? void 0 : _a.value) !== null && _b !== void 0 ? _b : '00'; };
    return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
}
