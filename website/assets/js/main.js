/* LifeLog marketing site — progressive enhancement only.
   Everything on the page reads and works with this file absent. */
(function () {
  'use strict';

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------------------------------------------------------------- header */
  var header = document.querySelector('.site-header');
  if (header) {
    var onScroll = function () {
      header.classList.toggle('is-scrolled', window.scrollY > 16);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  /* ------------------------------------------------------------ mobile nav */
  var toggle = document.querySelector('.nav-toggle');
  var mobileNav = document.getElementById('mobile-nav');
  if (toggle && mobileNav) {
    var setNav = function (open) {
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
      mobileNav.hidden = !open;
    };
    toggle.addEventListener('click', function () {
      setNav(toggle.getAttribute('aria-expanded') !== 'true');
    });
    mobileNav.addEventListener('click', function (e) {
      if (e.target.closest('a')) setNav(false);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') {
        setNav(false);
        toggle.focus();
      }
    });
    window.addEventListener('resize', function () {
      if (window.innerWidth >= 960) setNav(false);
    });
  }

  /* --------------------------------------------------------- scroll reveal */
  var revealables = document.querySelectorAll('.reveal');
  if (revealables.length) {
    if (reduceMotion || !('IntersectionObserver' in window)) {
      revealables.forEach(function (el) { el.classList.add('is-visible'); });
    } else {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('is-visible');
          io.unobserve(entry.target);
        });
      }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
      revealables.forEach(function (el, i) {
        el.style.setProperty('--reveal-delay', (i % 6) * 60 + 'ms');
        io.observe(el);
      });
    }
  }

  /* -------------------------------------------------------- active nav link */
  var navLinks = Array.prototype.slice.call(document.querySelectorAll('.nav a[href^="#"]'));
  var sections = navLinks
    .map(function (a) { return document.querySelector(a.getAttribute('href')); })
    .filter(Boolean);
  if (sections.length && 'IntersectionObserver' in window) {
    var spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        navLinks.forEach(function (a) {
          if (a.getAttribute('href') === '#' + entry.target.id) a.setAttribute('aria-current', 'true');
          else a.removeAttribute('aria-current');
        });
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    sections.forEach(function (s) { spy.observe(s); });
  }

  /* ------------------------------------------------------------- sandbox */
  var form = document.getElementById('sandbox-form');
  var input = document.getElementById('sandbox-input');
  var list = document.getElementById('sandbox-list');
  var count = document.getElementById('sandbox-count');
  if (form && input && list && count) {
    var KINDS = {
      expense: { dot: 'dot--expense' },
      time:    { dot: 'dot--time' },
      event:   { dot: 'dot--event' },
      note:    { dot: 'dot--note' }
    };

    /* Deliberately a demo parser, not the app's. The real one lives in
       src/lib/parser.ts and is the only thing that writes real entries. */
    var classify = function (text) {
      var money = text.match(/(?:₹|rs\.?\s*|inr\s*)(\d[\d,]*)/i) ||
                  text.match(/(\d[\d,]*)\s*(?=rs\b|rupees\b)/i);
      if (money || /\b\d+\s*(lunch|dinner|coffee|chai|tea|groceries|cab|fuel|paid|spent|bought)\b/i.test(text)) {
        var n = money ? money[1] : (text.match(/\d[\d,]*/) || ['' ])[0];
        return { kind: 'expense', amount: n ? '₹' + n : 'Expense' };
      }
      var dur = text.match(/\b(\d+(?:\.\d+)?\s*h(?:\s*\d+\s*m)?|\d+\s*(?:min|mins|m)\b)/i);
      if (dur || /\b(deep work|worked|focus|refactor|prototype|coding|writing)\b/i.test(text)) {
        return { kind: 'time', amount: dur ? dur[1].replace(/\s+/g, ' ') : 'Logged' };
      }
      if (/\b(call|meeting|sync|standup|dentist|doctor|appointment|tomorrow|tonight|\d{1,2}\s*(?:am|pm))\b/i.test(text)) {
        return { kind: 'event', amount: 'Upcoming' };
      }
      return { kind: 'note', amount: 'Held' };
    };

    var render = function (text) {
      var parsed = classify(text);
      var li = document.createElement('li');
      li.className = 'entry is-new';

      var main = document.createElement('div');
      main.className = 'entry__main';

      var dot = document.createElement('span');
      dot.className = 'dot ' + KINDS[parsed.kind].dot;
      dot.setAttribute('aria-hidden', 'true');

      var body = document.createElement('div');
      var label = document.createElement('div');
      label.className = 'entry__text';
      label.textContent = text;
      var time = document.createElement('div');
      time.className = 'entry__time';
      time.textContent = 'Just now · ' + parsed.kind;

      body.appendChild(label);
      body.appendChild(time);
      main.appendChild(dot);
      main.appendChild(body);

      var amount = document.createElement('span');
      amount.className = 'entry__amount';
      amount.textContent = parsed.amount;

      li.appendChild(main);
      li.appendChild(amount);
      return li;
    };

    var add = function (text) {
      var value = (text || '').trim();
      if (!value) return;
      list.prepend(render(value));
      count.textContent = list.children.length + ' entries';
      list.scrollTop = 0;
      input.value = '';
    };

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      add(input.value);
      input.focus();
    });

    document.querySelectorAll('.chip-btn').forEach(function (chip) {
      chip.addEventListener('click', function () { add(chip.textContent); });
    });

    count.textContent = list.children.length + ' entries';
  }

  /* ------------------------------------------------------------- year */
  var year = document.getElementById('year');
  if (year) year.textContent = String(new Date().getFullYear());
})();
