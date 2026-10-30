import { config } from './config.js';
import { escapeHtml as esc, formatMoscowTime } from './util.js';

const { telegram: tg } = config;

export const isTelegramConfigured = () => Boolean(tg.token && tg.chatIds.length);

const call = async (method, body = {}, signal) => {
    const res = await fetch(`${tg.api}/bot${tg.token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: signal || AbortSignal.timeout(15000),
    });
    const data = await res.json().catch(() => ({}));
    if (!data.ok) throw new Error(`Telegram ${method}: ${data.description || res.status}`);
    return data.result;
};

const TITLES = {
    driver: '🚗 <b>Заявка · Водитель</b>',
    booking: '🏍 <b>Бронь · Развлечения и отдых</b>',
    eva: '💬 <b>Заявка из чата Eva</b>',
};

/** Собирает текст сообщения о заявке (HTML для Telegram). */
export const formatLead = (lead) => {
    const lines = [TITLES[lead.type] || '📩 <b>Новая заявка</b>', ''];
    lines.push(`👤 <b>Имя:</b> ${esc(lead.name)}`);
    lines.push(`📞 <b>Телефон:</b> ${esc(lead.phone)}`);

    if (lead.type === 'driver' && lead.car) lines.push(`🚘 <b>Автомобиль:</b> ${esc(lead.car)}`);

    if (lead.type === 'booking') {
        const items = Object.entries(lead.items || {}).filter(([, n]) => n > 0);
        lines.push(`🧾 <b>Что берём:</b> ${items.length ? items.map(([k, n]) => `${esc(k)} × ${n}`).join(', ') : '—'}`);
        if (lead.date) lines.push(`📅 <b>Дата:</b> ${esc(lead.date)}`);
        if (lead.time) lines.push(`⏰ <b>Время:</b> ${esc(lead.time)}`);
    }

    if (lead.type === 'eva') {
        if (lead.service) lines.push(`🎯 <b>Интересует:</b> ${esc(lead.service)}`);
        if (lead.comment) lines.push(`📝 <b>Комментарий:</b> ${esc(lead.comment)}`);
    }

    lines.push('', `🕒 ${formatMoscowTime()} (МСК) · сайт`);
    return lines.join('\n');
};

let leadCounter = 0;
const nextLeadId = () => `${Date.now().toString(36)}${(leadCounter++ % 36).toString(36)}`;

/** Отправляет заявку во все настроенные чаты. Возвращает число доставленных копий. */
export const sendLead = async (lead) => {
    const text = formatLead(lead);
    const id = nextLeadId();

    if (!isTelegramConfigured()) {
        if (config.production) throw new Error('Telegram не настроен');
        console.log(`[dev] Telegram не настроен, заявка #${id} не отправлена:\n${text.replace(/<[^>]+>/g, '')}\n`);
        return 0;
    }

    const results = await Promise.allSettled(
        tg.chatIds.map((chat_id) =>
            call('sendMessage', {
                chat_id,
                text,
                parse_mode: 'HTML',
                disable_web_page_preview: true,
                reply_markup: { inline_keyboard: [[{ text: '✅ Взять в работу', callback_data: `take:${id}` }]] },
            }),
        ),
    );

    results.forEach((r) => r.status === 'rejected' && console.error('Не удалось отправить заявку:', r.reason.message));
    const delivered = results.filter((r) => r.status === 'fulfilled').length;
    if (!delivered) throw new Error('Заявка не доставлена ни в один чат');
    return delivered;
};

/* ---------- Бот: /start, /id и кнопка «Взять в работу» (long polling) ---------- */

const userLabel = (u = {}) => u.username ? `@${u.username}` : [u.first_name, u.last_name].filter(Boolean).join(' ') || 'менеджер';

const handleMessage = async (msg) => {
    const text = (msg.text || '').trim();
    if (!/^\/(start|id|help)(@\w+)?$/i.test(text)) return;

    const known = tg.chatIds.includes(String(msg.chat.id));
    await call('sendMessage', {
        chat_id: msg.chat.id,
        parse_mode: 'HTML',
        text: [
            '👋 Это бот приёма заявок с сайта «Такси и отдых».',
            '',
            `ID этого чата: <code>${msg.chat.id}</code>`,
            known
                ? '✅ Чат подключён — заявки приходят сюда.'
                : 'Чтобы получать заявки, добавьте этот ID в <code>TELEGRAM_CHAT_IDS</code> в файле .env и перезапустите сервер.',
        ].join('\n'),
    });
};

const handleCallback = async (cq) => {
    const chatId = String(cq.message?.chat?.id ?? '');
    if (!tg.chatIds.includes(chatId)) {
        return call('answerCallbackQuery', { callback_query_id: cq.id });
    }

    if (cq.data?.startsWith('take:')) {
        const taker = userLabel(cq.from);
        await call('editMessageReplyMarkup', {
            chat_id: cq.message.chat.id,
            message_id: cq.message.message_id,
            reply_markup: { inline_keyboard: [[{ text: `🟢 В работе: ${taker}`, callback_data: 'noop' }]] },
        });
        return call('answerCallbackQuery', { callback_query_id: cq.id, text: 'Заявка закреплена за вами' });
    }

    return call('answerCallbackQuery', { callback_query_id: cq.id, text: 'Заявка уже в работе' });
};

let stopped = false;

export const startPolling = () => {
    if (!tg.token || !tg.polling) return;
    stopped = false;
    let offset = 0;

    (async () => {
        console.log('Telegram-бот: long polling запущен');
        while (!stopped) {
            try {
                const updates = await call(
                    'getUpdates',
                    { offset, timeout: 25, allowed_updates: ['message', 'callback_query'] },
                    AbortSignal.timeout(40000),
                );
                for (const u of updates) {
                    offset = u.update_id + 1;
                    try {
                        if (u.message) await handleMessage(u.message);
                        else if (u.callback_query) await handleCallback(u.callback_query);
                    } catch (e) {
                        console.error('Telegram update:', e.message);
                    }
                }
            } catch (e) {
                if (stopped) break;
                console.error('Telegram polling:', e.message);
                // 409 — запущен второй экземпляр бота; ждём дольше
                await new Promise((r) => setTimeout(r, /409|Conflict/i.test(e.message) ? 15000 : 5000));
            }
        }
    })();
};

export const stopPolling = () => { stopped = true; };
