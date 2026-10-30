/** Экранирование для Telegram parse_mode=HTML */
export const escapeHtml = (s) =>
    String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Обрезает, схлопывает пробелы и убирает управляющие символы. */
export const clean = (v, max = 200) =>
    typeof v === 'string'
        ? v.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').replace(/\s+/g, ' ').trim().slice(0, max)
        : '';

/** Российский номер → «+7 (999) 123-45-67» или null. */
export const normalizePhone = (v) => {
    let d = String(v || '').replace(/\D/g, '');
    if (d.length === 11 && (d[0] === '7' || d[0] === '8')) d = d.slice(1);
    if (d.length !== 10) return null;
    return `+7 (${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6, 8)}-${d.slice(8)}`;
};

/** Простейший лимитер «N запросов за окно» в памяти процесса. */
export const createLimiter = (limit, windowMs) => {
    const hits = new Map();
    setInterval(() => {
        const now = Date.now();
        for (const [k, arr] of hits) {
            const fresh = arr.filter((t) => now - t < windowMs);
            fresh.length ? hits.set(k, fresh) : hits.delete(k);
        }
    }, windowMs).unref();

    return (key) => {
        const now = Date.now();
        const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
        if (arr.length >= limit) {
            hits.set(key, arr);
            return false;
        }
        arr.push(now);
        hits.set(key, arr);
        return true;
    };
};

export class HttpError extends Error {
    constructor(status, code, message) {
        super(message || code);
        this.status = status;
        this.code = code;
    }
}

export const readJson = (req, maxBytes = 16 * 1024) =>
    new Promise((resolve, reject) => {
        let size = 0;
        const chunks = [];
        req.on('data', (chunk) => {
            size += chunk.length;
            if (size > maxBytes) {
                reject(new HttpError(413, 'payload_too_large'));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => {
            try {
                resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
            } catch {
                reject(new HttpError(400, 'bad_json'));
            }
        });
        req.on('error', reject);
    });

export const formatMoscowTime = (date = new Date()) =>
    new Intl.DateTimeFormat('ru-RU', {
        timeZone: 'Europe/Moscow',
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    }).format(date);
