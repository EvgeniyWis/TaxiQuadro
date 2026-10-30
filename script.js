(() => {
    'use strict';

    const $ = (sel, root = document) => root.querySelector(sel);
    const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

    /* ---------- Мобильное меню ---------- */
    const burger = $('#burger');
    const nav = $('#nav');

    const setMenu = (open) => {
        burger.setAttribute('aria-expanded', String(open));
        nav.classList.toggle('is-open', open);
    };

    burger.addEventListener('click', () => setMenu(burger.getAttribute('aria-expanded') !== 'true'));
    nav.addEventListener('click', (e) => { if (e.target.closest('a')) setMenu(false); });
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.header')) setMenu(false);
    });

    /* ---------- Параллакс 3D-колеса за курсором (до 20px) ---------- */
    const wheel = $('#wheel');
    const hero = $('#hero');
    const canHover = window.matchMedia('(hover: hover)').matches;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (wheel && canHover && !reduceMotion) {
        hero.addEventListener('mousemove', (e) => {
            const r = hero.getBoundingClientRect();
            const dx = (e.clientX - r.left) / r.width - 0.5;
            const dy = (e.clientY - r.top) / r.height - 0.5;
            wheel.style.transform = `translate(${(dx * 40).toFixed(1)}px, ${(dy * 40).toFixed(1)}px)`;
        });
        hero.addEventListener('mouseleave', () => { wheel.style.transform = ''; });
    }

    /* ---------- Появление блоков при прокрутке ---------- */
    const REVEAL = [
        '.sec-head', '.taxi__intro', '.photo-card', '.map', '.plus', '.role',
        '.tcard', '.lvl', '.route', '.mcard', '.conds', '.form-card', '.pay-card',
        '.footer__brand', '.footer__col', '.note',
    ].join(',');

    const revealEls = $$(REVEAL).filter((el) => !el.closest('.hero'));

    if (reduceMotion || !('IntersectionObserver' in window)) {
        revealEls.forEach((el) => el.classList.add('is-in'));
    } else {
        // задержка по порядку среди соседей одного типа — карточки идут каскадом
        const seen = new Map();
        revealEls.forEach((el) => {
            el.classList.add('reveal');
            const key = el.parentElement;
            const idx = seen.get(key) || 0;
            seen.set(key, idx + 1);
            el.style.setProperty('--d', `${Math.min(idx, 4) * 110}ms`);
        });

        const io = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting) return;
                entry.target.classList.add('is-in');
                io.unobserve(entry.target);
            });
        }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });

        revealEls.forEach((el) => io.observe(el));
    }

    /* ---------- Модальные окна ---------- */
    const openModal = (name) => {
        const dlg = $(`#modal-${name}`);
        if (dlg && !dlg.open) dlg.showModal();
    };

    document.addEventListener('click', (e) => {
        const opener = e.target.closest('[data-open]');
        if (opener) {
            e.preventDefault();
            openModal(opener.dataset.open);
            return;
        }
        if (e.target.closest('[data-close]')) {
            e.target.closest('dialog').close();
            return;
        }
        // клик по подложке закрывает окно
        if (e.target instanceof HTMLDialogElement && e.target.open) e.target.close();
    });

    /* Ссылка на онлайн-оплату задаётся в <meta name="pay-url">; пока её нет — кнопка скрыта */
    const payLink = $('#pay-link');
    const payUrl = document.querySelector('meta[name="pay-url"]')?.content.trim();
    if (payUrl) payLink.href = payUrl;
    else {
        payLink.hidden = true;
        $('.modal__or')?.setAttribute('hidden', '');
    }

    /* ---------- Маски полей ---------- */
    const digits = (v) => v.replace(/\D/g, '');

    const masks = {
        phone(v) {
            let d = digits(v);
            if (d.startsWith('8') || d.startsWith('7')) d = d.slice(1);
            d = d.slice(0, 10);
            if (!d.length) return '';
            let out = '+7 (' + d.slice(0, 3);
            if (d.length >= 3) out += ')';
            if (d.length > 3) out += ' ' + d.slice(3, 6);
            if (d.length > 6) out += '-' + d.slice(6, 8);
            if (d.length > 8) out += '-' + d.slice(8, 10);
            return out;
        },
        date(v) {
            const d = digits(v).slice(0, 8);
            let out = d.slice(0, 2);
            if (d.length > 2) out += '.' + d.slice(2, 4);
            if (d.length > 4) out += '.' + d.slice(4, 8);
            return out;
        },
        time(v) {
            const d = digits(v).slice(0, 4);
            return d.length > 2 ? d.slice(0, 2) + ':' + d.slice(2) : d;
        },
    };

    $$('input[data-mask]').forEach((input) => {
        input.addEventListener('input', () => {
            const isDelete = input.dataset.deleting === '1';
            input.value = masks[input.dataset.mask](input.value);
            if (isDelete && /[\s()\-.:]$/.test(input.value)) input.value = input.value.slice(0, -1);
        });
        input.addEventListener('keydown', (e) => {
            input.dataset.deleting = e.key === 'Backspace' ? '1' : '0';
        });
    });

    /* Короткие плейсхолдеры на мобильных */
    const mobileMq = window.matchMedia('(max-width: 640px)');
    const setPlaceholders = () => {
        $$('[data-placeholder-m]').forEach((el) => {
            if (!el.dataset.placeholderD) el.dataset.placeholderD = el.placeholder;
            el.placeholder = mobileMq.matches ? el.dataset.placeholderM : el.dataset.placeholderD;
        });
    };
    setPlaceholders();
    mobileMq.addEventListener('change', setPlaceholders);

    /* ---------- Счётчики техники ---------- */
    const counters = $$('.counter');

    const syncCounter = (counter) => {
        const val = Number($('.counter__val', counter).textContent);
        counter.classList.toggle('is-active', val > 0);
    };

    const setCounter = (counter, value) => {
        $('.counter__val', counter).textContent = Math.max(0, Math.min(99, value));
        syncCounter(counter);
    };

    counters.forEach((counter) => {
        $('.counter__btn--minus', counter).addEventListener('click', () => {
            setCounter(counter, Number($('.counter__val', counter).textContent) - 1);
        });
        $('.counter__btn--plus', counter).addEventListener('click', () => {
            setCounter(counter, Number($('.counter__val', counter).textContent) + 1);
        });
    });

    /* Кнопки «Забронировать» ведут к форме и подставляют технику */
    $$('[data-book]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const target = counters.find((c) => c.dataset.counter === btn.dataset.book);
            if (target && Number($('.counter__val', target).textContent) === 0) setCounter(target, 1);
            $('#booking').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' });
        });
    });

    /* ---------- API ---------- */
    const API = (document.querySelector('meta[name="api-base"]')?.content || '').replace(/\/$/, '');

    const postJson = async (path, body) => {
        let res;
        try {
            res = await fetch(API + path, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
        } catch {
            throw Object.assign(new Error('network'), { code: 'network' });
        }
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.ok === false) throw Object.assign(new Error(data.error || 'failed'), { code: data.error || 'failed' });
        return data;
    };

    const LEAD_ERRORS = {
        bad_name: 'Укажите имя.',
        bad_phone: 'Проверьте номер телефона.',
        bad_date: 'Дата указана неверно — формат дд.мм.гггг.',
        bad_time: 'Время указано неверно — формат чч:мм.',
        no_items: 'Выберите хотя бы одну единицу техники.',
        too_many_requests: 'Слишком много заявок подряд. Попробуйте позже или позвоните нам.',
    };
    const FALLBACK_ERROR = 'Не удалось отправить заявку. Позвоните нам: +7 952 353-45-45.';

    /* ---------- Отправка форм ---------- */
    const validate = (form) => {
        let ok = true;
        $$('.field', form).forEach((field) => {
            const input = $('input', field);
            if (!input || !input.required) return;
            const value = input.value.trim();
            const valid = input.name === 'phone' ? digits(value).length === 11 : value.length > 1;
            field.classList.toggle('is-invalid', !valid);
            if (!valid) ok = false;
        });
        return ok;
    };

    const resetCounters = () => counters.forEach((c, i) => setCounter(c, i === 0 ? 2 : 0));

    const showFormError = (form, text) => {
        const box = $('.form-error', form);
        box.textContent = text || '';
        box.hidden = !text;
    };

    const buildLead = (form) => {
        const f = Object.fromEntries(new FormData(form));
        if (form.id === 'booking-form') {
            return {
                type: 'booking',
                name: f.name,
                phone: f.phone,
                date: f.date,
                time: f.time,
                website: f.website,
                items: Object.fromEntries(counters.map((c) => [c.dataset.counter, Number($('.counter__val', c).textContent)])),
            };
        }
        return { type: 'driver', name: f.name, phone: f.phone, car: f.car, website: f.website };
    };

    $$('form.form-card').forEach((form) => {
        const submit = $('button[type="submit"]', form);
        const submitLabel = submit.textContent;

        form.addEventListener('input', (e) => {
            e.target.closest('.field')?.classList.remove('is-invalid');
            showFormError(form, '');
        });

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            showFormError(form, '');
            if (!validate(form)) {
                $('.is-invalid input', form)?.focus();
                return;
            }

            submit.disabled = true;
            submit.textContent = 'Отправляем…';
            try {
                await postJson('/api/lead', buildLead(form));
                form.reset();
                if (form.id === 'booking-form') resetCounters();
                openModal('sent');
            } catch (err) {
                showFormError(form, LEAD_ERRORS[err.code] || FALLBACK_ERROR);
            } finally {
                submit.disabled = false;
                submit.textContent = submitLabel;
            }
        });
    });
})();
