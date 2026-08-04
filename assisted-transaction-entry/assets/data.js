/* ------------------------------------------------------------------
   data.js — sample categories, merchants and synthesised spend history
   ------------------------------------------------------------------
   In a shipping app all of this comes from the user's own budget: their
   category list, their transaction history, their saved places. For the
   prototype it is generated deterministically so every visitor sees the
   same "two months of spending" and the inference has real priors to
   work from.
------------------------------------------------------------------- */

const CATEGORIES = [
  { id: 'groceries',     name: 'Groceries',        icon: '🛒', color: '#2e7d5b' },
  { id: 'dining',        name: 'Dining & Drinks',  icon: '🍽️', color: '#c05621' },
  { id: 'coffee',        name: 'Coffee',           icon: '☕', color: '#8b5e3c' },
  { id: 'fuel',          name: 'Fuel',             icon: '⛽', color: '#3f5f8f' },
  { id: 'transit',       name: 'Transportation',   icon: '🚇', color: '#4a5aa8' },
  { id: 'shopping',      name: 'Shopping',         icon: '🛍️', color: '#a1487a' },
  { id: 'home',          name: 'Home & Hardware',  icon: '🔧', color: '#6b7280' },
  { id: 'health',        name: 'Health & Pharmacy',icon: '💊', color: '#2b7a9b' },
  { id: 'entertainment', name: 'Entertainment',    icon: '🎬', color: '#7a4bb5' },
  { id: 'subscriptions', name: 'Subscriptions',    icon: '🔁', color: '#485b6b' },
  { id: 'personal',      name: 'Personal Care',    icon: '✂️', color: '#b5486c' },
  { id: 'pets',          name: 'Pets',             icon: '🐾', color: '#7d6b3f' },
  { id: 'travel',        name: 'Travel',           icon: '✈️', color: '#1f7a8c' },
  { id: 'bills',         name: 'Bills & Utilities',icon: '📄', color: '#5a6d7e' },
  { id: 'gifts',         name: 'Gifts',            icon: '🎁', color: '#b03a48' }
];

const CATEGORY_BY_ID = Object.fromEntries(CATEGORIES.map(c => [c.id, c]));

/* Hour-of-day weight curve. `open`/`close` bound the merchant's hours,
   `peaks` are the hours where visits actually cluster. Everything gets a
   small floor so an unusual hour is unlikely, not impossible. */
function hourCurve(open, close, peaks = []) {
  const w = new Array(24).fill(0.02);
  for (let h = 0; h < 24; h++) {
    const inHours = close > open ? (h >= open && h < close) : (h >= open || h < close);
    if (inHours) w[h] = 0.35;
  }
  peaks.forEach(p => {
    for (let d = -2; d <= 2; d++) {
      const h = (p + d + 24) % 24;
      w[h] = Math.max(w[h], 1 - Math.abs(d) * 0.28);
    }
  });
  return w;
}

const ALL_DAY = hourCurve(0, 24);

/* Merchants the user has some relationship with. `geo` is a real
   Philadelphia coordinate so the distance maths is genuine; `amount`
   describes a log-normal spend distribution (median + sigma in log
   space); `visitsPerWeek` drives both the synthetic history and the
   frequency prior. */
const MERCHANTS = [
  {
    id: 'lacolombe', name: 'La Colombe', category: 'coffee',
    aliases: ['la colombe', 'lacolombe', 'colombe', 'la colombe coffee roasters'],
    brand: ['#111111', '#c8102e'], signWords: ['la colombe', 'coffee'],
    geo: { lat: 39.9496, lng: -75.1685 }, address: '1414 S Penn Sq, Philadelphia',
    amount: { median: 6.4, sigma: 0.34 }, hours: hourCurve(6, 19, [8, 15]),
    visitsPerWeek: 3.4, itemWords: ['latte', 'cold brew', 'draft latte', 'espresso', 'croissant']
  },
  {
    id: 'starbucks', name: 'Starbucks', category: 'coffee',
    aliases: ['starbucks', 'starbucks coffee'],
    brand: ['#00704a', '#1e3932'], signWords: ['starbucks'],
    geo: { lat: 39.9512, lng: -75.1642 }, address: '1528 Walnut St, Philadelphia',
    amount: { median: 7.15, sigma: 0.36 }, hours: hourCurve(5, 21, [8, 14]),
    visitsPerWeek: 0.9, itemWords: ['frappuccino', 'pike place', 'macchiato', 'cold brew']
  },
  {
    id: 'wawa', name: 'Wawa', category: 'dining',
    aliases: ['wawa', 'wawa food market', 'wawa inc'],
    brand: ['#d71920', '#ffc72c'], signWords: ['wawa'],
    geo: { lat: 39.9553, lng: -75.1601 }, address: '1707 Arch St, Philadelphia',
    amount: { median: 9.8, sigma: 0.62 }, hours: ALL_DAY,
    visitsPerWeek: 1.8, itemWords: ['hoagie', 'shorti', 'coffee', 'sizzli'],
    /* Wawa is genuinely ambiguous — a $9 stop is lunch, a $52 stop is gas. */
    categoryRules: [{ max: 20, category: 'dining' }, { min: 30, category: 'fuel' }]
  },
  {
    id: 'traderjoes', name: "Trader Joe's", category: 'groceries',
    aliases: ["trader joe's", 'trader joes', 'traderjoes', 'trader joe'],
    brand: ['#d8202f', '#f5f0e6'], signWords: ["trader joe's", 'trader joes'],
    geo: { lat: 39.9526, lng: -75.1738 }, address: '2121 Market St, Philadelphia',
    amount: { median: 54.2, sigma: 0.44 }, hours: hourCurve(8, 21, [11, 18]),
    visitsPerWeek: 1.1, itemWords: ['bananas', 'oat milk', 'frozen', 'produce', 'organic']
  },
  {
    id: 'wholefoods', name: 'Whole Foods Market', category: 'groceries',
    aliases: ['whole foods', 'whole foods market', 'wholefoods', 'wfm'],
    brand: ['#00674b', '#1a1a1a'], signWords: ['whole foods'],
    geo: { lat: 39.9573, lng: -75.1719 }, address: '2101 Pennsylvania Ave, Philadelphia',
    amount: { median: 71.5, sigma: 0.48 }, hours: hourCurve(7, 22, [12, 18]),
    visitsPerWeek: 0.7, itemWords: ['organic', '365', 'produce', 'kombucha']
  },
  {
    id: 'readingterminal', name: 'Reading Terminal Market', category: 'groceries',
    aliases: ['reading terminal', 'reading terminal market', 'rtm'],
    brand: ['#8b1a1a', '#f0e2c0'], signWords: ['reading terminal'],
    geo: { lat: 39.9533, lng: -75.1590 }, address: '51 N 12th St, Philadelphia',
    amount: { median: 24.5, sigma: 0.55 }, hours: hourCurve(8, 18, [12]),
    visitsPerWeek: 0.5, itemWords: ['cheese', 'butcher', 'produce', 'amish']
  },
  {
    id: 'sweetgreen', name: 'Sweetgreen', category: 'dining',
    aliases: ['sweetgreen', 'sweet green', 'sweetgreen inc'],
    brand: ['#00473f', '#e8f0d8'], signWords: ['sweetgreen'],
    geo: { lat: 39.9502, lng: -75.1698 }, address: '1601 Chestnut St, Philadelphia',
    amount: { median: 15.1, sigma: 0.28 }, hours: hourCurve(10, 21, [12, 19]),
    visitsPerWeek: 1.4, itemWords: ['harvest bowl', 'kale caesar', 'guacamole greens', 'salad']
  },
  {
    id: 'federaldonuts', name: 'Federal Donuts', category: 'dining',
    aliases: ['federal donuts', 'fed donuts', 'federal donut'],
    brand: ['#f4a71d', '#2b2b2b'], signWords: ['federal donuts'],
    geo: { lat: 39.9707, lng: -75.1339 }, address: '1632 Sansom St, Philadelphia',
    amount: { median: 12.6, sigma: 0.4 }, hours: hourCurve(7, 15, [9]),
    visitsPerWeek: 0.4, itemWords: ['donut', 'fried chicken', 'coffee']
  },
  {
    id: 'target', name: 'Target', category: 'shopping',
    aliases: ['target', 'target store', 'target corp'],
    brand: ['#cc0000', '#ffffff'], signWords: ['target'],
    geo: { lat: 39.9558, lng: -75.1560 }, address: '1900 Chestnut St, Philadelphia',
    amount: { median: 46.8, sigma: 0.65 }, hours: hourCurve(8, 22, [13, 19]),
    visitsPerWeek: 0.6, itemWords: ['up & up', 'good & gather', 'threshold', 'household']
  },
  {
    id: 'homedepot', name: 'The Home Depot', category: 'home',
    aliases: ['home depot', 'the home depot', 'homedepot', 'hd'],
    brand: ['#f96302', '#ffffff'], signWords: ['home depot'],
    geo: { lat: 39.9210, lng: -75.1443 }, address: '1651 S Columbus Blvd, Philadelphia',
    amount: { median: 58.4, sigma: 0.78 }, hours: hourCurve(6, 22, [10, 16]),
    visitsPerWeek: 0.35, itemWords: ['lumber', 'ryobi', 'paint', 'hardware', 'behr']
  },
  {
    id: 'cvs', name: 'CVS Pharmacy', category: 'health',
    aliases: ['cvs', 'cvs pharmacy', 'cvs/pharmacy'],
    brand: ['#cc0000', '#0055a5'], signWords: ['cvs', 'pharmacy'],
    geo: { lat: 39.9490, lng: -75.1626 }, address: '1201 Walnut St, Philadelphia',
    amount: { median: 21.3, sigma: 0.6 }, hours: hourCurve(7, 23, [18]),
    visitsPerWeek: 0.5, itemWords: ['prescription', 'rx', 'vitamin', 'advil']
  },
  {
    id: 'riteaid', name: 'Rite Aid', category: 'health',
    aliases: ['rite aid', 'riteaid'],
    brand: ['#0067a5', '#e01a2b'], signWords: ['rite aid'],
    geo: { lat: 39.9440, lng: -75.1621 }, address: '727 South St, Philadelphia',
    amount: { median: 18.7, sigma: 0.58 }, hours: hourCurve(8, 22, [19]),
    visitsPerWeek: 0.25, itemWords: ['prescription', 'rx', 'bandage']
  },
  {
    id: 'sunoco', name: 'Sunoco', category: 'fuel',
    aliases: ['sunoco', 'sunoco a plus', 'sunoco aplus'],
    brand: ['#003da5', '#fdb913'], signWords: ['sunoco'],
    geo: { lat: 39.9629, lng: -75.1806 }, address: '2401 Fairmount Ave, Philadelphia',
    amount: { median: 47.9, sigma: 0.3 }, hours: ALL_DAY,
    visitsPerWeek: 0.5, itemWords: ['unleaded', 'gallons', 'pump', 'regular']
  },
  {
    id: 'septa', name: 'SEPTA', category: 'transit',
    aliases: ['septa', 'septa key', 'septa transit'],
    brand: ['#0d47a1', '#f5f5f5'], signWords: ['septa'],
    geo: { lat: 39.9540, lng: -75.1650 }, address: 'Broad St Line, Philadelphia',
    amount: { median: 2.5, sigma: 0.18 }, hours: hourCurve(5, 24, [8, 18]),
    visitsPerWeek: 2.2, itemWords: ['key card', 'fare', 'ride']
  },
  {
    id: 'uber', name: 'Uber', category: 'transit',
    aliases: ['uber', 'uber trip', 'uber technologies'],
    brand: ['#000000', '#ffffff'], signWords: ['uber'], online: true,
    amount: { median: 17.4, sigma: 0.52 }, hours: hourCurve(0, 24, [22, 8]),
    visitsPerWeek: 0.8, itemWords: ['trip', 'ride', 'fare']
  },
  {
    id: 'amazon', name: 'Amazon', category: 'shopping',
    aliases: ['amazon', 'amazon.com', 'amzn mktp'],
    brand: ['#ff9900', '#232f3e'], signWords: ['amazon'], online: true,
    amount: { median: 32.9, sigma: 0.8 }, hours: hourCurve(0, 24, [21]),
    visitsPerWeek: 1.3, itemWords: ['order', 'prime']
  },
  {
    id: 'petco', name: 'Petco', category: 'pets',
    aliases: ['petco', 'petco animal supplies'],
    brand: ['#0071ce', '#e4002b'], signWords: ['petco'],
    geo: { lat: 39.9518, lng: -75.1780 }, address: '2100 Chestnut St, Philadelphia',
    amount: { median: 43.2, sigma: 0.5 }, hours: hourCurve(9, 21, [17]),
    visitsPerWeek: 0.22, itemWords: ['dog food', 'litter', 'treats', 'kibble']
  },
  {
    id: 'ritzfive', name: 'Ritz Five', category: 'entertainment',
    aliases: ['ritz five', 'ritz 5', 'landmark ritz'],
    brand: ['#3b1f5e', '#d4af37'], signWords: ['ritz'],
    geo: { lat: 39.9463, lng: -75.1455 }, address: '214 Walnut St, Philadelphia',
    amount: { median: 16.5, sigma: 0.22 }, hours: hourCurve(12, 23, [19]),
    visitsPerWeek: 0.2, itemWords: ['admission', 'matinee', 'ticket']
  },
  {
    id: 'groom', name: 'Groom Barbershop', category: 'personal',
    aliases: ['groom', 'groom barbershop', 'groom barber'],
    brand: ['#2f4858', '#c9a227'], signWords: ['groom', 'barber'],
    geo: { lat: 39.9639, lng: -75.1720 }, address: '2001 Fairmount Ave, Philadelphia',
    amount: { median: 38, sigma: 0.16 }, hours: hourCurve(9, 19, [11]),
    visitsPerWeek: 0.2, itemWords: ['haircut', 'beard trim', 'tip']
  },
  /* Recurring charges — no location, exact amounts, monthly cadence. */
  {
    id: 'netflix', name: 'Netflix', category: 'subscriptions',
    aliases: ['netflix', 'netflix.com'], brand: ['#e50914', '#141414'],
    signWords: ['netflix'], online: true, recurring: { amount: 15.49, dayOfMonth: 7 },
    amount: { median: 15.49, sigma: 0.02 }, hours: ALL_DAY, visitsPerWeek: 0.23
  },
  {
    id: 'spotify', name: 'Spotify', category: 'subscriptions',
    aliases: ['spotify', 'spotify usa'], brand: ['#1db954', '#191414'],
    signWords: ['spotify'], online: true, recurring: { amount: 11.99, dayOfMonth: 19 },
    amount: { median: 11.99, sigma: 0.02 }, hours: ALL_DAY, visitsPerWeek: 0.23
  },
  {
    id: 'peco', name: 'PECO Energy', category: 'bills',
    aliases: ['peco', 'peco energy', 'exelon peco'], brand: ['#00539b', '#8dc63f'],
    signWords: ['peco'], online: true, recurring: { amount: 94.18, dayOfMonth: 12 },
    amount: { median: 94.18, sigma: 0.12 }, hours: ALL_DAY, visitsPerWeek: 0.23
  }
];

const MERCHANT_BY_ID = Object.fromEntries(MERCHANTS.map(m => [m.id, m]));

/* Places the phone might think it is. A real build reads this from
   CoreLocation; here it is a picker so the flow can be demonstrated
   from a desk. */
const LOCATIONS = [
  { id: 'rittenhouse', label: 'Rittenhouse Square', lat: 39.9497, lng: -75.1719 },
  { id: 'fairmount',   label: 'Home — Fairmount',   lat: 39.9660, lng: -75.1740 },
  { id: 'centercity',  label: 'Center City East',   lat: 39.9526, lng: -75.1595 },
  { id: 'columbus',    label: 'Columbus Blvd',      lat: 39.9215, lng: -75.1440 },
  { id: 'off',         label: 'Location off',       lat: null,    lng: null }
];

/* Word → category map used when there is no known merchant to lean on:
   receipt line items, packaging text, the note field. */
const CATEGORY_KEYWORDS = {
  groceries: ['produce', 'milk', 'eggs', 'bread', 'grocery', 'organic', 'yogurt', 'chicken breast',
              'bananas', 'avocado', 'cereal', 'pasta', 'frozen', 'deli', 'oat milk', 'coffee beans'],
  dining:    ['restaurant', 'cafe', 'bistro', 'taqueria', 'pizza', 'burger', 'sandwich', 'hoagie',
              'entree', 'appetizer', 'server', 'gratuity', 'tip', 'dine in', 'take out', 'bowl',
              'salad', 'brunch', 'beer', 'cocktail', 'wine', 'draft', 'kitchen', 'grill'],
  coffee:    ['latte', 'espresso', 'cappuccino', 'americano', 'cold brew', 'macchiato', 'mocha',
              'drip coffee', 'roasters', 'flat white', 'cortado'],
  fuel:      ['unleaded', 'gallons', 'gal', 'pump', 'diesel', 'regular unleaded', 'premium unleaded', 'fuel', 'gasoline'],
  transit:   ['fare', 'transit', 'metro', 'subway', 'rail', 'trip', 'ride', 'parking', 'toll', 'garage'],
  shopping:  ['apparel', 'clothing', 'shirt', 'shoes', 'electronics', 'cable', 'charger', 'order',
              'household', 'towels', 'storage bin'],
  home:      ['lumber', 'screws', 'paint', 'hardware', 'plumbing', 'drill', 'sandpaper', 'caulk',
              'furnace filter', 'light bulb', 'tool'],
  health:    ['prescription', 'rx', 'pharmacy', 'ibuprofen', 'vitamin', 'bandage', 'copay', 'clinic',
              'dental', 'advil', 'allergy'],
  entertainment: ['ticket', 'admission', 'matinee', 'concert', 'theatre', 'theater', 'museum', 'popcorn'],
  subscriptions: ['subscription', 'monthly plan', 'membership', 'renewal', 'premium plan'],
  personal:  ['haircut', 'barber', 'salon', 'beard trim', 'manicure', 'spa', 'shampoo'],
  pets:      ['dog food', 'cat food', 'litter', 'kibble', 'leash', 'treats', 'vet', 'pet'],
  travel:    ['hotel', 'airline', 'baggage', 'boarding', 'resort', 'airbnb', 'rental car'],
  bills:     ['electric', 'utility', 'water bill', 'internet', 'wireless', 'statement', 'account number'],
  gifts:     ['gift', 'gift card', 'wrapping', 'greeting card']
};

/* ---- deterministic PRNG so the seeded history never shifts ---- */
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rand) {
  let u = 0, v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/* Draws an hour from a merchant's hour curve rather than uniformly, so
   the time-of-day prior the inference relies on is actually present in
   the data it learns from. */
function sampleHour(curve, rand) {
  const total = curve.reduce((a, b) => a + b, 0);
  let r = rand() * total;
  for (let h = 0; h < 24; h++) {
    r -= curve[h];
    if (r <= 0) return h;
  }
  return 12;
}

function buildHistory(days = 60, now = new Date()) {
  const rand = mulberry32(20240719);
  const out = [];

  MERCHANTS.forEach(m => {
    if (m.recurring) {
      for (let back = 0; back < Math.ceil(days / 30); back++) {
        const d = new Date(now);
        d.setMonth(d.getMonth() - back);
        d.setDate(m.recurring.dayOfMonth);
        d.setHours(3 + Math.floor(rand() * 4), Math.floor(rand() * 60), 0, 0);
        if (d <= now && (now - d) / 86400000 <= days) {
          out.push({
            id: 'h' + out.length, merchantId: m.id, merchant: m.name,
            amount: m.recurring.amount, category: m.category,
            at: d.toISOString(), source: 'seed'
          });
        }
      }
      return;
    }

    const visits = Math.round((m.visitsPerWeek * days) / 7);
    for (let i = 0; i < visits; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() - Math.floor(rand() * days));
      d.setHours(sampleHour(m.hours, rand), Math.floor(rand() * 60), 0, 0);
      if (d > now) d.setDate(d.getDate() - 1);
      const amount = Math.max(1, Math.exp(Math.log(m.amount.median) + gaussian(rand) * m.amount.sigma));
      out.push({
        id: 'h' + out.length, merchantId: m.id, merchant: m.name,
        amount: Math.round(amount * 100) / 100,
        category: resolveCategoryRules(m, amount),
        at: d.toISOString(), source: 'seed'
      });
    }
  });

  return out.sort((a, b) => new Date(b.at) - new Date(a.at));
}

/* A merchant's category can depend on the amount — see Wawa. */
function resolveCategoryRules(merchant, amount) {
  if (!merchant.categoryRules) return merchant.category;
  for (const rule of merchant.categoryRules) {
    if (rule.max != null && amount <= rule.max) return rule.category;
    if (rule.min != null && amount >= rule.min) return rule.category;
  }
  return merchant.category;
}

const MONTHLY_BUDGETS = {
  groceries: 520, dining: 340, coffee: 90, fuel: 140, transit: 80,
  shopping: 260, home: 120, health: 90, entertainment: 90,
  subscriptions: 130, personal: 60, pets: 60, travel: 200, bills: 240, gifts: 70
};

window.BudgetData = {
  CATEGORIES, CATEGORY_BY_ID, MERCHANTS, MERCHANT_BY_ID, LOCATIONS,
  CATEGORY_KEYWORDS, MONTHLY_BUDGETS, buildHistory, resolveCategoryRules, mulberry32
};
