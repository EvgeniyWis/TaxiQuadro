import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { config, ROOT } from './config.js';
import { HttpError, clean, createLimiter, normalizePhone, readJson } from './util.js';
import { isTelegramConfigured, sendLead, startPolling, stopPolling } from './telegram.js';
import { askEva, isEvaConfigured, sanitizeHistory } from './eva.js';

/* ---------- Статика (только публичные файлы сайта, сервер и .env недоступны) ---------- */

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.jpg': 'image/jpeg',
    '.webp': 'image/webp',
};

const PAGES = { '/': 'index.html', '/index.html': 'index.html', '/style.css': 'style.css', '/script.js': 'script.js' };

const resolveStatic = (pathname) => {
    if (PAGES[pathname]) return path.join(ROOT, PAGES[pathname]);
    const m = pathname.match(/^\/img\/([\w.-]+)$/);
    return m ? path.join(ROOT, 'img', m[1]) : null;
};

const serveStatic = (req, res, pathname) => {
    const file = resolveStatic(pathname);
    const type = file && MIME[path.extname(file).toLowerCase()];
    if (!file || !type || !fs.existsSync(file) || !fs.statSync(file).isFile()) return false;

    res.writeHead(200, {
        'Content-Type': type,
        'Cache-Control': pathname.startsWith('/img/') ? 'public, max-age=86400' : 'no-cache',
    });
    if (req.method === 'HEAD') res.end();
    else fs.createReadStream(file).pipe(res);
    return true;
};

/* ---------- Утилиты ответа ---------- */

// виджет ассистента Eva (<script> в index.html) грузится и работает с eva.bz
const EVA_HOSTS = 'https://eva.bz https://*.eva.bz';

const SECURITY_HEADERS = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Content-Security-Policy': [
        "default-src 'self'",
        `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com ${EVA_HOSTS}`,
        `font-src https://fonts.gstatic.com ${EVA_HOSTS}`,
        `img-src 'self' data: ${EVA_HOSTS}`,
        `script-src 'self' ${EVA_HOSTS}`,
        `connect-src 'self' ${EVA_HOSTS} wss://eva.bz wss://*.eva.bz`,
        `frame-src ${EVA_HOSTS}`,
        "frame-ancestors 'none'",
    ].join('; '),
};

const json = (res, status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
};

const clientIp = (req) =>
    (config.trustProxy && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || 'unknown';

/* ---------- Валидация заявок ---------- */

const ITEM_NAMES = ['Квадроциклы', 'Сапы', 'Велосипеды', 'Эндуро'];

/** Приводит тело запроса к безопасной заявке или бросает HttpError(400). */
export const parseLead = (body) => {
    const type = body.type;
    if (type !== 'driver' && type !== 'booking') throw new HttpError(400, 'bad_type');

    const name = clean(body.name, 60);
    if (name.length < 2) throw new HttpError(400, 'bad_name');

    const phone = normalizePhone(body.phone);
    if (!phone) throw new HttpError(400, 'bad_phone');

    const lead = { type, name, phone };

    if (type === 'driver') {
        lead.car = clean(body.car, 100);
    } else {
        const items = {};
        for (const key of ITEM_NAMES) {
            const n = Math.floor(Number(body.items?.[key]) || 0);
            items[key] = Math.min(Math.max(n, 0), 50);
        }
        if (!Object.values(items).some((n) => n > 0)) throw new HttpError(400, 'no_items');
        lead.items = items;

        const date = clean(body.date, 10);
        const time = clean(body.time, 5);
        if (date && !/^\d{2}\.\d{2}\.\d{4}$/.test(date)) throw new HttpError(400, 'bad_date');
        if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new HttpError(400, 'bad_time');
        lead.date = date;
        lead.time = time;
    }
    return lead;
};

/* ---------- API ---------- */

const leadLimiter = createLimiter(6, 10 * 60 * 1000);
const evaLimiter = createLimiter(30, 10 * 60 * 1000);

const routes = {
    'POST /api/lead': async (req, res) => {
        const ip = clientIp(req);
        if (!leadLimiter(ip)) throw new HttpError(429, 'too_many_requests');

        const body = await readJson(req);
        if (clean(body.website, 50)) return json(res, 200, { ok: true }); // honeypot: тихо игнорируем ботов

        await sendLead(parseLead(body));
        json(res, 200, { ok: true });
    },

    'POST /api/eva': async (req, res) => {
        const ip = clientIp(req);
        if (!evaLimiter(ip)) throw new HttpError(429, 'too_many_requests');
        if (!isEvaConfigured()) throw new HttpError(503, 'eva_unavailable');

        const body = await readJson(req);
        const history = sanitizeHistory(body.messages);
        if (!history.length || history[history.length - 1].role !== 'user') throw new HttpError(400, 'bad_messages');

        const result = await askEva(history, {
            createLead: async (lead) => {
                if (!leadLimiter(ip)) throw new Error('rate limit');
                await sendLead(lead);
            },
        });
        json(res, 200, { ok: true, ...result });
    },

    'GET /api/health': async (req, res) => {
        json(res, 200, { ok: true, telegram: isTelegramConfigured(), eva: isEvaConfigured() });
    },
};

export const server = http.createServer(async (req, res) => {
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);

    const { pathname } = new URL(req.url, 'http://localhost');

    if (config.allowedOrigin && pathname.startsWith('/api/')) {
        res.setHeader('Access-Control-Allow-Origin', config.allowedOrigin);
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        res.setHeader('Vary', 'Origin');
        if (req.method === 'OPTIONS') {
            res.writeHead(204);
            return res.end();
        }
    }

    const handler = routes[`${req.method} ${pathname}`];
    if (handler) {
        try {
            await handler(req, res);
        } catch (e) {
            const status = e instanceof HttpError ? e.status : 500;
            if (status === 500) console.error('API error:', e);
            if (!res.headersSent) json(res, status, { ok: false, error: e instanceof HttpError ? e.code : 'server_error' });
        }
        return;
    }

    if ((req.method === 'GET' || req.method === 'HEAD') && serveStatic(req, res, pathname)) return;

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
});

/* ---------- Запуск ---------- */

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
    server.listen(config.port, () => {
        console.log(`Сайт: http://localhost:${config.port}`);
        console.log(`Telegram: ${isTelegramConfigured() ? 'настроен' : 'НЕ настроен (TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_IDS)'}`);
        console.log(`Eva / OpenAI: ${isEvaConfigured() ? `настроена (${config.openai.model})` : 'НЕ настроена (OPENAI_API_KEY)'}`);
        startPolling();
    });

    const shutdown = () => {
        stopPolling();
        server.close(() => process.exit(0));
        setTimeout(() => process.exit(0), 3000).unref();
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}
