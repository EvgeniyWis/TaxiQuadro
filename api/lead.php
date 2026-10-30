<?php
/**
 * POST /api/lead — приём заявок на обычном PHP-хостинге (аналог server/index.js → /api/lead).
 * Заявка уходит в Telegram и/или на почту — см. lead-config.example.php.
 */
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

function respond(int $status, array $body)
{
    http_response_code($status);
    echo json_encode($body, JSON_UNESCAPED_UNICODE);
    exit;
}

function clean($v, int $max = 200): string
{
    if (!is_string($v)) return '';
    $v = preg_replace('/[\x00-\x08\x0B-\x1F\x7F]/', '', $v) ?? '';
    $v = preg_replace('/\s+/u', ' ', $v) ?? '';
    return mb_substr(trim($v), 0, $max);
}

function normalizePhone($v): ?string
{
    $d = preg_replace('/\D/', '', (string) $v) ?? '';
    if (strlen($d) === 11 && ($d[0] === '7' || $d[0] === '8')) $d = substr($d, 1);
    if (strlen($d) !== 10) return null;
    return sprintf('+7 (%s) %s-%s-%s', substr($d, 0, 3), substr($d, 3, 3), substr($d, 6, 2), substr($d, 8));
}

/** Привязка к IP: не больше $limit заявок за $window секунд (счётчик — файлы во временной папке). */
function allowRequest(string $ip, int $limit = 6, int $window = 600): bool
{
    $file = sys_get_temp_dir() . '/lead_' . hash('sha256', $ip) . '.json';
    $now = time();
    $hits = [];
    if (is_file($file)) {
        $hits = json_decode((string) @file_get_contents($file), true) ?: [];
        $hits = array_values(array_filter($hits, fn($t) => is_int($t) && $now - $t < $window));
    }
    if (count($hits) >= $limit) return false;
    $hits[] = $now;
    @file_put_contents($file, json_encode($hits), LOCK_EX);
    return true;
}

function parseLead(array $body): array
{
    $type = $body['type'] ?? '';
    if ($type !== 'driver' && $type !== 'booking') respond(400, ['ok' => false, 'error' => 'bad_type']);

    $name = clean($body['name'] ?? null, 60);
    if (mb_strlen($name) < 2) respond(400, ['ok' => false, 'error' => 'bad_name']);

    $phone = normalizePhone($body['phone'] ?? '');
    if ($phone === null) respond(400, ['ok' => false, 'error' => 'bad_phone']);

    $lead = ['type' => $type, 'name' => $name, 'phone' => $phone];

    if ($type === 'driver') {
        $lead['car'] = clean($body['car'] ?? null, 100);
        return $lead;
    }

    $items = [];
    $raw = is_array($body['items'] ?? null) ? $body['items'] : [];
    foreach (['Квадроциклы', 'Сапы', 'Велосипеды', 'Эндуро'] as $key) {
        $items[$key] = max(0, min(50, (int) floor((float) ($raw[$key] ?? 0))));
    }
    if (!array_filter($items)) respond(400, ['ok' => false, 'error' => 'no_items']);

    $date = clean($body['date'] ?? null, 10);
    $time = clean($body['time'] ?? null, 5);
    if ($date !== '' && !preg_match('/^\d{2}\.\d{2}\.\d{4}$/', $date)) respond(400, ['ok' => false, 'error' => 'bad_date']);
    if ($time !== '' && !preg_match('/^([01]\d|2[0-3]):[0-5]\d$/', $time)) respond(400, ['ok' => false, 'error' => 'bad_time']);

    return $lead + ['items' => $items, 'date' => $date, 'time' => $time];
}

/** Текст заявки: строки без разметки; для Telegram потом экранируется. */
function leadLines(array $lead): array
{
    $titles = ['driver' => '🚗 Заявка · Водитель', 'booking' => '🏍 Бронь · Развлечения и отдых'];
    $lines = [$titles[$lead['type']], '', '👤 Имя: ' . $lead['name'], '📞 Телефон: ' . $lead['phone']];

    if ($lead['type'] === 'driver' && $lead['car'] !== '') $lines[] = '🚘 Автомобиль: ' . $lead['car'];

    if ($lead['type'] === 'booking') {
        $items = [];
        foreach ($lead['items'] as $k => $n) if ($n > 0) $items[] = "$k × $n";
        $lines[] = '🧾 Что берём: ' . ($items ? implode(', ', $items) : '—');
        if ($lead['date'] !== '') $lines[] = '📅 Дата: ' . $lead['date'];
        if ($lead['time'] !== '') $lines[] = '⏰ Время: ' . $lead['time'];
    }

    $now = (new DateTime('now', new DateTimeZone('Europe/Moscow')))->format('d.m H:i');
    $lines[] = '';
    $lines[] = "🕒 $now (МСК) · сайт";
    return $lines;
}

function sendTelegram(array $cfg, array $lines): bool
{
    $token = (string) ($cfg['telegram_token'] ?? '');
    $chats = array_filter((array) ($cfg['telegram_chat_ids'] ?? []));
    if ($token === '' || !$chats) return false;

    // заголовок жирным, остальное — с экранированием
    $esc = fn(string $s) => str_replace(['&', '<', '>'], ['&amp;', '&lt;', '&gt;'], $s);
    $text = '<b>' . $esc(array_shift($lines)) . '</b>' . "\n" . implode("\n", array_map($esc, $lines));

    $delivered = false;
    foreach ($chats as $chat) {
        $payload = json_encode([
            'chat_id' => (string) $chat,
            'text' => $text,
            'parse_mode' => 'HTML',
            'disable_web_page_preview' => true,
        ], JSON_UNESCAPED_UNICODE);
        $ctx = stream_context_create(['http' => [
            'method' => 'POST',
            'header' => "Content-Type: application/json\r\n",
            'content' => $payload,
            'timeout' => 10,
            'ignore_errors' => true,
        ]]);
        $res = @file_get_contents("https://api.telegram.org/bot{$token}/sendMessage", false, $ctx);
        $data = is_string($res) ? json_decode($res, true) : null;
        if (is_array($data) && !empty($data['ok'])) $delivered = true;
        else error_log('lead.php: Telegram: ' . ($data['description'] ?? 'нет ответа'));
    }
    return $delivered;
}

function sendMail(array $cfg, array $lines): bool
{
    $to = (string) ($cfg['mail_to'] ?? '');
    if ($to === '') return false;
    $from = (string) ($cfg['mail_from'] ?? 'noreply@' . preg_replace('/^www\./', '', $_SERVER['HTTP_HOST'] ?? 'localhost'));
    $subject = '=?UTF-8?B?' . base64_encode('Новая заявка с сайта') . '?=';
    $headers = "From: $from\r\nContent-Type: text/plain; charset=UTF-8\r\nMIME-Version: 1.0";
    return @mail($to, $subject, implode("\n", $lines), $headers);
}

/* ---------- запрос ---------- */

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') respond(405, ['ok' => false, 'error' => 'method_not_allowed']);

$raw = file_get_contents('php://input', false, null, 0, 16 * 1024 + 1);
if ($raw === false || strlen($raw) > 16 * 1024) respond(413, ['ok' => false, 'error' => 'payload_too_large']);
$body = json_decode($raw, true);
if (!is_array($body)) respond(400, ['ok' => false, 'error' => 'bad_json']);

if (clean($body['website'] ?? null, 50) !== '') respond(200, ['ok' => true]); // honeypot

$ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
if (!allowRequest($ip)) respond(429, ['ok' => false, 'error' => 'too_many_requests']);

$lead = parseLead($body);

// настройки лежат вне папки сайта (см. lead-config.example.php), запасной вариант — рядом со скриптом
$cfg = [];
foreach ([dirname(__DIR__, 3) . '/lead-config.php', __DIR__ . '/lead-config.php'] as $path) {
    if (is_file($path)) { $cfg = (array) include $path; break; }
}

$lines = leadLines($lead);
$ok = sendTelegram($cfg, $lines);
$ok = sendMail($cfg, $lines) || $ok;

if (!$ok) respond(500, ['ok' => false, 'error' => 'send_failed']);
respond(200, ['ok' => true]);
