const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { JSDOM } = require('jsdom');

const script = fs.readFileSync(path.join(__dirname, '..', 'x-clean-ui.user.js'), 'utf8');
const post = (id, header, content = 'ordinary text', extra = '') => `
  <article data-testid="tweet" id="${id}">
    ${header}
    <div data-testid="tweetText">${content}</div>
    ${extra}
    <div role="group">
      <div role="button" data-testid="reply" id="${id}-reply"><svg></svg><span data-testid="app-text-transition-container">29</span></div>
      <div role="button" data-testid="retweet" id="${id}-retweet"><svg></svg><span>1.2K</span></div>
      <div role="button" data-testid="like" id="${id}-like"><svg></svg><span>709</span></div>
      <a href="/user/status/123/analytics" id="${id}-views"><svg></svg><span>1.3万</span></a>
    </div>
  </article>`;

function setup(t, html, url = 'https://x.com/home') {
  const dom = new JSDOM(`<!doctype html><html><head></head><body>${html}</body></html>`, {
    url,
    runScripts: 'outside-only',
  });
  t.after(() => dom.window.close());
  dom.window.eval(script);
  return dom.window;
}

const tick = (window) => new Promise((resolve) => window.setTimeout(resolve, 0));
const homeTabs = (labels) => `<main><div data-testid="primaryColumn"><nav role="tablist">
  ${labels.map((label) => `<a role="tab" href="#${label}"><span>${label}</span></a>`).join('')}
</nav></div></main>`;
const mobileHomeTabs = (labels, selected = -1) => `<header><nav role="tablist">
  ${labels.map((label, index) => `<a role="tab" aria-selected="${selected === index}" href="${index > 1 ? `/i/lists/${index + 100}` : '#home'}"><span>${label}</span></a>`).join('')}
</nav></header>`;
const selectableTabs = (labels, selected) => `<main><div data-testid="primaryColumn"><nav role="tablist">
  ${labels.map((label, index) => `<a role="tab" aria-selected="${index === selected}" href="${index > 1 ? `/i/lists/${index + 100}` : '#home'}"><span>${label}</span></a>`).join('')}
</nav></div></main>`;

function trackSelections(window) {
  const tabs = [...window.document.querySelectorAll('[role="tab"]')];
  const clicks = [];
  for (const tab of tabs) tab.addEventListener('click', (event) => {
    event.preventDefault(); // X handles timeline tabs with client-side navigation.
    clicks.push(tab.textContent);
    for (const other of tabs) other.setAttribute('aria-selected', String(other === tab));
  });
  return { tabs, clicks };
}

test('independent Japanese, Promoted and Sponsored labels hide the entire article without placementTracking', (t) => {
  const window = setup(t, [
    post('jp', '<div data-testid="User-Name"><a href="/starlink">Starlink</a><span>  広告  </span></div>'),
    post('en', '<div data-testid="User-Name"><a href="/brand">Brand</a><span> Promoted </span></div>'),
    post('sponsored', '<div data-testid="User-Name"><a href="/brand">Brand</a><span>Sponsored</span></div>'),
  ].join(''));

  for (const id of ['jp', 'en', 'sponsored']) {
    const article = window.document.getElementById(id);
    assert.ok(article.classList.contains('x-clean-ui-ad'), id);
    assert.equal(window.getComputedStyle(article).display, 'none');
    assert.ok(article.isConnected, 'article must not be removed');
  }
});

test('post content, quotes, media descriptions and tracking alone do not hide ordinary posts', (t) => {
  const samples = [
    post('is-ad', '', 'これは広告です'),
    post('not-ad', '', 'これは広告じゃない'),
    post('industry', '', '広告業界について'),
    post('ordinary', '', 'ordinary text'),
    post('tracking', '<div data-testid="placementTracking"></div>'),
    post('exact-body', '', '広告'),
    post('english-body', '', 'Promoted'),
    post('quote', '', 'regular', '<div data-testid="quoteTweet"><span>広告</span></div>'),
    post('media', '', 'regular', '<div data-testid="card.wrapper"><span>Promoted</span></div>'),
    post('media-caption', '', 'regular', '<div data-testid="media-container"><span>広告</span></div>'),
    post('after-body', '', 'regular', '<span>Sponsored</span>'),
    post('author', '<div data-testid="User-Name"><a href="/ad"><span>広告</span></a></div>'),
    post('nested-quote', '', 'regular', '<article data-testid="tweet"><div data-testid="tweetText">広告</div></article>'),
  ];
  const window = setup(t, samples.join(''));
  for (const article of window.document.querySelectorAll('article[data-testid="tweet"]')) {
    assert.equal(article.classList.contains('x-clean-ui-ad'), false, article.id);
    assert.notEqual(window.getComputedStyle(article).display, 'none', article.id);
  }
});

test('new posts and changed labels follow scrolling and SPA navigation without a full document rescan', async (t) => {
  const window = setup(t, post('original', ''));
  const { document } = window;
  const originalQuery = document.querySelectorAll.bind(document);
  let fullScans = 0;
  document.querySelectorAll = (...args) => {
    fullScans++;
    return originalQuery(...args);
  };

  const container = document.createElement('div');
  container.innerHTML = post('later', '<div data-testid="User-Name"><span>広告</span></div>');
  document.body.append(container);
  await tick(window);
  const later = document.getElementById('later');
  assert.ok(later.classList.contains('x-clean-ui-ad'));

  const label = later.querySelector('[data-testid="User-Name"] span');
  label.textContent = 'ordinary';
  await tick(window);
  assert.equal(later.classList.contains('x-clean-ui-ad'), false);
  label.textContent = 'Promoted';
  await tick(window);
  assert.ok(later.classList.contains('x-clean-ui-ad'));
  later.className = '';
  await tick(window);
  assert.ok(later.classList.contains('x-clean-ui-ad'), 'React class rewrite');

  const route = document.createElement('div');
  route.innerHTML = post('route', '<span>Sponsored</span>');
  document.body.replaceChildren(route);
  await tick(window);
  assert.ok(document.getElementById('route').classList.contains('x-clean-ui-ad'));
  assert.equal(fullScans, 0);
});

test('existing action counts remain hidden and buttons clickable', (t) => {
  const window = setup(t, post('normal', '', '2026 and 29'));
  const { document } = window;
  for (const type of ['reply', 'retweet', 'like', 'views']) {
    const button = document.getElementById(`normal-${type}`);
    const count = button.querySelector('.x-clean-ui-count');
    assert.ok(count, type);
    assert.equal(window.getComputedStyle(count).visibility, 'hidden');
    assert.equal(window.getComputedStyle(button).visibility, 'visible');
  }
  let clicks = 0;
  document.getElementById('normal-like').addEventListener('click', () => clicks++);
  document.getElementById('normal-like').click();
  assert.equal(clicks, 1);
  assert.equal(document.querySelector('[data-testid="tweetText"]').textContent, '2026 and 29');
});

test('home timeline hides only For you and Following tabs in Japanese and English', (t) => {
  const window = setup(t, homeTabs(['テック', 'おすすめ', 'AI', 'フォロー中', 'ゲーム', 'ソフトウェア', 'For you', 'Following']));
  const tabs = [...window.document.querySelectorAll('[role="tab"]')];
  for (const tab of tabs) {
    const target = ['おすすめ', 'フォロー中', 'For you', 'Following'].includes(tab.textContent.trim());
    assert.equal(tab.classList.contains('x-clean-ui-home-tab'), target, tab.textContent);
    assert.equal(window.getComputedStyle(tab).display === 'none', target, tab.textContent);
  }
});

test('similarly named content and non-home tabs remain visible', (t) => {
  const window = setup(t, homeTabs(['おすすめ映画', 'フォロー中のアカウント', 'テック']) +
    '<div role="tablist"><a role="tab">おすすめ</a></div>' +
    post('plain', '', 'おすすめ フォロー中'));
  assert.equal(window.document.querySelectorAll('.x-clean-ui-home-tab').length, 0);
  assert.equal(window.document.querySelector('[data-testid="tweetText"]').textContent, 'おすすめ フォロー中');
});

test('twitter.com mobile-width home and other routes use the same scoped rule', async (t) => {
  const window = setup(t, homeTabs(['For you', 'Following', 'AI']), 'https://twitter.com/home');
  Object.defineProperty(window, 'innerWidth', { value: 390 });
  const tabs = [...window.document.querySelectorAll('[role="tab"]')];
  assert.deepEqual(tabs.map((tab) => window.getComputedStyle(tab).display === 'none'), [true, true, false]);
  window.history.pushState({}, '', '/explore');
  window.document.body.append(window.document.createElement('div'));
  await tick(window);
  assert.equal(tabs[0].classList.contains('x-clean-ui-home-tab'), false);
  assert.equal(tabs[1].classList.contains('x-clean-ui-home-tab'), false);
  window.history.pushState({}, '', '/home');
  window.dispatchEvent(new window.PopStateEvent('popstate'));
  assert.ok(tabs[0].classList.contains('x-clean-ui-home-tab'));
  assert.ok(tabs[1].classList.contains('x-clean-ui-home-tab'));
  const outsideHome = setup(t, homeTabs(['おすすめ', 'フォロー中', 'テック']), 'https://x.com/example');
  assert.equal(outsideHome.document.querySelectorAll('.x-clean-ui-home-tab').length, 0);
});

test('iPhone-style home tabs outside main and primaryColumn hide only defaults and retain custom lists', async (t) => {
  const window = setup(t, mobileHomeTabs(['おすすめ', 'フォロー中', 'テック', 'AI', 'ゲーム'], 0), 'https://x.com/home');
  Object.defineProperty(window, 'innerWidth', { value: 390 });
  const { tabs, clicks } = trackSelections(window);
  for (const [index, tab] of tabs.entries()) {
    assert.equal(window.getComputedStyle(tab).display === 'none', index < 2, tab.textContent);
  }
  await tick(window);
  assert.deepEqual(clicks, ['テック']);
});

test('new mobile home tablists are processed locally and never affect non-home tablists', async (t) => {
  const window = setup(t, '<div role="tablist"><a role="tab">おすすめ</a></div>', 'https://twitter.com/home');
  const { document } = window;
  assert.equal(document.querySelector('.x-clean-ui-home-tab'), null);
  const originalQuery = document.querySelectorAll.bind(document);
  let scans = 0;
  document.querySelectorAll = (...args) => { scans++; return originalQuery(...args); };
  const wrapper = document.createElement('div');
  wrapper.innerHTML = mobileHomeTabs(['おすすめ', 'フォロー中', 'サッカー', 'AI']);
  document.body.append(wrapper);
  await tick(window);
  const tabs = wrapper.querySelectorAll('[role="tab"]');
  assert.deepEqual([...tabs].map((tab) => window.getComputedStyle(tab).display === 'none'), [true, true, false, false]);
  assert.equal(scans, 0);

  window.history.pushState({}, '', '/search');
  wrapper.querySelector('nav').append(document.createElement('span'));
  await tick(window);
  assert.deepEqual([...tabs].map((tab) => window.getComputedStyle(tab).display === 'none'), [false, false, false, false]);
});

test('mobile Home waits for both standard tabs and rechecks earlier siblings when the second appears', async (t) => {
  const window = setup(t, mobileHomeTabs(['おすすめ', 'テック'], 0), 'https://x.com/home');
  const list = window.document.querySelector('[role="tablist"]');
  const [recommended, custom] = list.querySelectorAll('[role="tab"]');
  assert.notEqual(window.getComputedStyle(recommended).display, 'none');
  const following = window.document.createElement('a');
  following.setAttribute('role', 'tab');
  following.textContent = 'フォロー中';
  custom.before(following);
  await tick(window);
  assert.equal(window.getComputedStyle(recommended).display, 'none');
  assert.equal(window.getComputedStyle(following).display, 'none');
  assert.notEqual(window.getComputedStyle(custom).display, 'none');
});

test('new or rerendered home tabs update without scanning the document again', async (t) => {
  const window = setup(t, homeTabs(['テック']));
  const { document } = window;
  const originalQuery = document.querySelectorAll.bind(document);
  let scans = 0;
  document.querySelectorAll = (...args) => { scans++; return originalQuery(...args); };
  const list = document.querySelector('[role="tablist"]');
  const tab = document.createElement('a');
  tab.setAttribute('role', 'tab');
  tab.textContent = 'フォロー中';
  list.append(tab);
  await tick(window);
  assert.ok(tab.classList.contains('x-clean-ui-home-tab'));
  tab.textContent = 'ゲーム';
  await tick(window);
  assert.equal(tab.classList.contains('x-clean-ui-home-tab'), false);
  tab.textContent = 'おすすめ';
  await tick(window);
  assert.ok(tab.classList.contains('x-clean-ui-home-tab'));
  tab.className = '';
  await tick(window);
  assert.ok(tab.classList.contains('x-clean-ui-home-tab'), 'React class overwrite');
  assert.equal(scans, 0);
});

test('opens the first currently rendered custom timeline, regardless of its name or order', async (t) => {
  const window = setup(t, selectableTabs(['おすすめ', 'フォロー中', 'サッカー', 'AI', 'ゲーム'], 0));
  const { tabs, clicks } = trackSelections(window);
  await tick(window);
  assert.deepEqual(clicks, ['サッカー']);
  assert.equal(tabs[2].getAttribute('aria-selected'), 'true');
  assert.equal(tabs[0].classList.contains('x-clean-ui-home-tab'), true);
  assert.equal(tabs[3].classList.contains('x-clean-ui-home-tab'), false);
});

test('does not switch away from an already selected custom timeline after a reorder', async (t) => {
  const window = setup(t, selectableTabs(['For you', 'Following', 'Technology', 'Gaming'], 3));
  const { tabs, clicks } = trackSelections(window);
  await tick(window);
  tabs[3].before(tabs[2]);
  await tick(window);
  assert.deepEqual(clicks, []);
  assert.equal(tabs[3].getAttribute('aria-selected'), 'true');
});

test('waits for a custom tab to render and uses its current position on SPA home entry', async (t) => {
  const window = setup(t, selectableTabs(['おすすめ', 'フォロー中'], 0), 'https://twitter.com/home');
  Object.defineProperty(window, 'innerWidth', { value: 390 });
  const { tabs, clicks } = trackSelections(window);
  await tick(window);
  assert.deepEqual(clicks, []);

  const list = window.document.querySelector('[role="tablist"]');
  const first = window.document.createElement('a');
  first.setAttribute('role', 'tab');
  first.setAttribute('aria-selected', 'false');
  first.setAttribute('href', '/i/lists/999');
  first.textContent = 'ゲーム';
  list.append(first);
  first.addEventListener('click', (event) => {
    event.preventDefault();
    clicks.push(first.textContent);
    first.setAttribute('aria-selected', 'true');
  });
  await tick(window);
  await tick(window);
  assert.deepEqual(clicks, ['ゲーム']);

  window.history.pushState({}, '', '/explore');
  window.document.body.append(window.document.createElement('div'));
  await tick(window);
  window.history.pushState({}, '', '/home');
  const newFirst = window.document.createElement('a');
  newFirst.setAttribute('role', 'tab');
  newFirst.setAttribute('aria-selected', 'false');
  newFirst.setAttribute('href', '/i/lists/777');
  newFirst.textContent = 'サッカー';
  list.insertBefore(newFirst, first);
  newFirst.addEventListener('click', (event) => { event.preventDefault(); clicks.push(newFirst.textContent); });
  for (const tab of [...tabs, first]) tab.setAttribute('aria-selected', String(tab === tabs[0]));
  await tick(window);
  await tick(window);
  assert.deepEqual(clicks, ['ゲーム', 'サッカー']);
});

test('waits for X to mark a selected tab before switching and follows reordered lists', async (t) => {
  const window = setup(t, selectableTabs(['おすすめ', 'フォロー中', 'AI', 'サッカー'], -1));
  const { tabs, clicks } = trackSelections(window);
  await tick(window);
  assert.deepEqual(clicks, []);
  tabs[2].before(tabs[3]);
  tabs[0].setAttribute('aria-selected', 'true');
  await tick(window);
  await tick(window);
  assert.deepEqual(clicks, ['サッカー']);
});

test('a selected custom list remains selected until removed; then the next available list opens', async (t) => {
  const window = setup(t, selectableTabs(['For you', 'Following', 'AI', 'Gaming'], 2));
  const { tabs, clicks } = trackSelections(window);
  await tick(window);
  assert.deepEqual(clicks, []);
  tabs[2].remove();
  tabs[0].setAttribute('aria-selected', 'true');
  await tick(window);
  await tick(window);
  assert.deepEqual(clicks, ['Gaming']);
});

test('a list URL identifies a custom tab even when its name matches a standard tab', async (t) => {
  const window = setup(t, selectableTabs(['For you', 'Following', 'Following', 'AI'], 0));
  const { tabs, clicks } = trackSelections(window);
  await tick(window);
  assert.deepEqual(clicks, ['Following']);
  assert.ok(tabs[1].classList.contains('x-clean-ui-home-tab'));
  assert.equal(tabs[2].classList.contains('x-clean-ui-home-tab'), false);
});
