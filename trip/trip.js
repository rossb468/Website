(function () {
    var T = window.TRIP;
    if (!T) return;

    function el(tag, cls, text) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text != null) e.textContent = text;
        return e;
    }

    function esc(s) {
        return String(s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    // Intro
    document.getElementById('trip-title').textContent = T.title;
    document.getElementById('trip-lede').textContent = T.lede;
    document.getElementById('trip-updated').textContent = T.status + ' Last updated ' + T.updated + '.';

    var nights = T.days.length - 1;
    var stats = [
        [T.days.length, 'days'],
        [T.totalMiles, 'miles'],
        [nights, 'nights on the road']
    ];
    var statsEl = document.getElementById('trip-stats');
    stats.forEach(function (s) {
        var d = el('div', 'stat');
        d.appendChild(el('span', 'stat-num', s[0]));
        d.appendChild(el('span', 'stat-label', s[1]));
        statsEl.appendChild(d);
    });

    // Map
    var map = L.map('map', { scrollWheelZoom: false, zoomSnap: 0.1 });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 18,
        className: 'dark-tiles'
    }).addTo(map);

    var accent = '#e3a35f';
    var lines = {};
    var allBounds = L.latLngBounds([]);
    var activeDay = null;

    function nightIcon(label, isEnd) {
        return L.divIcon({
            className: '',
            html: '<div class="night-pin' + (isEnd ? ' end' : '') + '">' + label + '</div>',
            iconSize: [26, 26],
            iconAnchor: [13, 13],
            popupAnchor: [0, -12]
        });
    }

    var sightIcon = L.divIcon({
        className: '',
        html: '<div class="sight-pin"></div>',
        iconSize: [10, 10],
        iconAnchor: [5, 5],
        popupAnchor: [0, -4]
    });

    T.days.forEach(function (d) {
        var line = L.polyline(d.route, { color: accent, weight: 3, opacity: 0.85, lineJoin: 'round' }).addTo(map);
        line.on('click', function () { focusDay(d.day, true); });
        lines[d.day] = line;
        allBounds.extend(line.getBounds());

        (d.sights || []).forEach(function (s) {
            L.marker(s.latlng, { icon: sightIcon, title: s.name })
                .addTo(map)
                .bindPopup('<span class="pop-day">Day ' + d.day + '</span><span class="pop-name">' + esc(s.name) + '</span>' + esc(s.fact));
        });
    });

    // Start marker
    L.marker(T.start.latlng, { icon: nightIcon('S'), title: T.start.name, zIndexOffset: 500 })
        .addTo(map)
        .bindPopup('<span class="pop-day">Start</span><span class="pop-name">' + esc(T.start.name) + '</span>');

    // Overnight markers, numbered by night
    T.days.forEach(function (d, i) {
        var isEnd = i === T.days.length - 1;
        var o = d.overnight;
        var html = '<span class="pop-day">' + (isEnd ? 'Day ' + d.day + ' · Arrive' : 'Night ' + d.day) + '</span>' +
            '<span class="pop-name">' + esc(o.name) + '</span>' +
            (o.fact ? esc(o.fact) + '<br>' : '') +
            '<a class="pop-link" href="#day-' + d.day + '">Day ' + d.day + ' details &darr;</a>';
        L.marker(o.latlng, { icon: nightIcon(isEnd ? '&#9873;' : d.day, isEnd), title: o.name, zIndexOffset: 1000 })
            .addTo(map)
            .bindPopup(html);
    });

    function fitAll() {
        map.fitBounds(allBounds, { padding: [24, 24] });
    }
    fitAll();

    function setActive(day) {
        activeDay = day;
        Object.keys(lines).forEach(function (k) {
            var on = day === null || Number(k) === day;
            lines[k].setStyle({ opacity: on ? 0.95 : 0.25, weight: day !== null && Number(k) === day ? 5 : 3 });
            if (day !== null && Number(k) === day) lines[k].bringToFront();
        });
        document.querySelectorAll('.day').forEach(function (c) {
            c.classList.toggle('active', Number(c.dataset.day) === day);
        });
    }

    function focusDay(day, scrollToCard) {
        setActive(day);
        map.fitBounds(lines[day].getBounds(), { padding: [40, 40], maxZoom: 10 });
        if (scrollToCard) {
            var card = document.getElementById('day-' + day);
            if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }

    document.getElementById('show-all').addEventListener('click', function () {
        setActive(null);
        fitAll();
    });

    // Day cards
    var daysEl = document.getElementById('days');
    T.days.forEach(function (d) {
        var card = el('article', 'day');
        card.id = 'day-' + d.day;
        card.dataset.day = d.day;

        var head = el('div', 'day-head');
        head.appendChild(el('span', 'day-num', 'Day ' + d.day));
        var btn = el('button', 'day-map-link', 'Show on map');
        btn.type = 'button';
        btn.addEventListener('click', function () {
            focusDay(d.day, false);
            document.getElementById('map').scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
        head.appendChild(btn);
        card.appendChild(head);

        card.appendChild(el('h2', null, d.from + ' → ' + d.to));
        card.appendChild(el('p', 'day-meta', 'About ' + d.miles + ' miles · ' + d.hours + ' hours of driving' + (d.extra ? ', ' + d.extra : '')));
        card.appendChild(el('p', 'day-summary', d.summary));

        var items = (d.sights || []).slice();
        if (d.overnight.fact) items.push({ name: d.overnight.name, fact: d.overnight.fact });
        if (items.length) {
            var ul = el('ul');
            items.forEach(function (s) {
                var li = el('li');
                li.appendChild(el('strong', null, s.name));
                li.appendChild(el('span', null, s.fact));
                ul.appendChild(li);
            });
            card.appendChild(ul);
        }

        if (d.hike) {
            var h = el('p', 'note');
            h.appendChild(el('b', null, 'Morning hike: '));
            h.appendChild(document.createTextNode(d.hike));
            card.appendChild(h);
        }
        if (d.leo) {
            var l = el('p', 'note');
            l.appendChild(el('b', null, 'With Leo: '));
            l.appendChild(document.createTextNode(d.leo));
            card.appendChild(l);
        }

        var last = d === T.days[T.days.length - 1];
        if (!last) {
            var n = el('p', 'note');
            n.appendChild(el('b', null, 'Overnight: '));
            n.appendChild(document.createTextNode(d.overnight.name));
            card.appendChild(n);
        }

        daysEl.appendChild(card);
    });
})();
