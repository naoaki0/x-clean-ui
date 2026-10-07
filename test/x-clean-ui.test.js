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
const statusPost = (id, statusId) => post(id,
  `<a href="/user/status/${statusId}"><time datetime="2026-09-30">午後2:34</time></a>`,
  '本文中の2026と135は残す', `
    <a href="/user/status/${statusId}/analytics" id="${id}-detail-views"><span><span>4.8万</span> 件の表示</span></a>
    <div role="group"><button data-testid="bookmark" id="${id}-bookmark"><svg></svg><span>135</span></button></div>
    <div data-testid="quoteTweet"><a href="/user/status/123"><time>引用の時刻</time></a></div>
    <div data-testid="tweetText"><a href="/user/status/123/analytics" id="${id}-body-link"><span>2026</span></a></div>`);

function setup(t, html, url = 'https://x.com/home', beforeRun) {
  const dom = new JSDOM(`<!doctype html><html><head></head><body>${html}</body></html>`, {
    url,
    runScripts: 'outside-only',
  });
  t.after(() => dom.window.close());
  beforeRun?.(dom.window);
  dom.window.eval(script);
  return dom.window;
}

const tick = (window) => new Promise((resolve) => window.setTimeout(resolve, 0));
const quoteTick = async (window) => { await tick(window); await tick(window); await tick(window); };
const quote = (id, lines, media = 'photo', attributes = 'data-testid="quoteTweet"') => `<div ${attributes} id="${id}">
  <div data-testid="User-Name">引用元</div>
  <div data-testid="tweetText" data-test-lines="${lines}" id="${id}-text">引用本文 ${'長い説明。'.repeat(lines)}</div>
  ${media === 'photo' ? `<a role="link"><div data-testid="tweetPhoto"><img id="${id}-media" src="https://example.com/photo.png" width="300" height="200"></div></a>` :
    media === 'video' ? `<div data-testid="videoPlayer"><video id="${id}-media" controls width="300" height="200"></video></div>` : ''}
</div>`;

function quoteLayout(window, maxLines = () => 3) {
  // JSDOM does not lay out text or evaluate media queries. Mock geometry here;
  // final appearance is checked in X on the actual device.
  Object.defineProperty(window.HTMLElement.prototype, 'clientHeight', { configurable: true, get() {
    const lines = Number(this.dataset.testLines || 0);
    return (this.classList.contains('x-clean-ui-quote-clamped') ? Math.min(lines, maxLines()) : lines) * 20;
  } });
  Object.defineProperty(window.HTMLElement.prototype, 'scrollHeight', { configurable: true, get() {
    return Number(this.dataset.testLines || 0) * 20;
  } });
  const originalRect = window.HTMLElement.prototype.getBoundingClientRect;
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    return this.hasAttribute('data-test-lines') ? { width: 300, top: 100, height: this.clientHeight } : originalRect.call(this);
  };
}
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

test('main and quoted text retain native width and wrapping without character limits', (t) => {
  const window = setup(t, post('desktop-width', '', '長い本文', quote('width-quote', 6)));
  const { document } = window;
  for (const text of document.querySelectorAll('[data-testid="tweetText"]')) {
    const style = window.getComputedStyle(text);
    assert.equal(style.getPropertyValue('max-width'), '');
    assert.equal(style.getPropertyValue('overflow-wrap'), '');
  }
});

test('only media quote text over three rendered lines is clamped; main text, short quotes and media stay intact', async (t) => {
  const window = setup(t, post('quotes', '', '通常本文は全文表示',
    quote('photo', 6) + quote('video', 5, 'video') + quote('short', 2) + quote('exact', 3) + quote('text-only', 8, '') + quote('role-quote', 5, 'photo', 'role="link"')),
  'https://x.com/home', quoteLayout);
  const { document } = window;
  const originalMedia = [...document.querySelectorAll('img, video')].map((media) => media.outerHTML);
  const main = document.querySelector('#quotes > [data-testid="tweetText"]');
  const mainHTML = main.outerHTML;
  await quoteTick(window);
  assert.equal(main.outerHTML, mainHTML);
  for (const id of ['photo', 'video', 'role-quote']) {
    const text = document.getElementById(`${id}-text`);
    assert.equal(window.getComputedStyle(text).getPropertyValue('-webkit-line-clamp'), '3');
    assert.equal(document.getElementById(id).querySelectorAll('.x-clean-ui-quote-toggle').length, 1);
    assert.equal(text.nextSibling.textContent, 'さらに表示');
  }
  for (const id of ['short', 'exact', 'text-only']) {
    assert.equal(document.getElementById(id).querySelector('.x-clean-ui-quote-toggle'), null);
    assert.equal(document.getElementById(`${id}-text`).classList.contains('x-clean-ui-quote-clamped'), false);
  }
  assert.deepEqual([...document.querySelectorAll('img, video')].map((media) => media.outerHTML), originalMedia);
  await quoteTick(window);
  let idleMutations = 0;
  const observer = new window.MutationObserver((records) => { idleMutations += records.length; });
  observer.observe(document.body, { attributes: true, childList: true, subtree: true });
  await quoteTick(window);
  observer.disconnect();
  assert.equal(idleMutations, 0, 'quote processing must settle, not generate an idle mutation loop');
});

test('small touch screens show four quote lines, expand the rest, and keep narrow desktop windows at three', async (t) => {
  let coarsePointer = true;
  const window = setup(t, post('mobile-quotes', '', '通常本文',
    quote('mobile-short', 3) + quote('mobile-exact', 4) + quote('mobile-long', 5, 'video') + quote('mobile-text-only', 8, '')),
  'https://x.com/home', (window) => {
    window.innerWidth = 390;
    quoteLayout(window, () => window.innerWidth <= 767 && coarsePointer ? 4 : 3);
  });
  const { document } = window;
  const mediaRule = [...document.styleSheets[0].cssRules].find((rule) => rule.conditionText === '(max-width: 767px) and (pointer: coarse)');
  const clampRule = [...mediaRule.cssRules].find((rule) => rule.selectorText === '.x-clean-ui-quote-clamped');
  for (const property of ['-webkit-line-clamp', 'line-clamp']) {
    assert.equal(clampRule.style.getPropertyValue(property), '4');
    if (property === '-webkit-line-clamp') assert.equal(clampRule.style.getPropertyPriority(property), 'important');
  }
  await quoteTick(window);
  for (const id of ['mobile-short', 'mobile-exact', 'mobile-text-only']) {
    assert.equal(document.getElementById(id).querySelector('.x-clean-ui-quote-toggle'), null);
  }
  const text = document.getElementById('mobile-long-text');
  const button = document.querySelector('#mobile-long .x-clean-ui-quote-toggle');
  assert.equal(text.clientHeight, 80);
  assert.equal(button.textContent, 'さらに表示');
  button.click();
  await quoteTick(window);
  assert.equal(text.clientHeight, 100);
  assert.equal(button.getAttribute('aria-expanded'), 'true');
  button.click();
  await quoteTick(window);
  assert.equal(text.clientHeight, 80);
  assert.equal(button.getAttribute('aria-expanded'), 'false');
  for (const [width, coarse, lines] of [[767, true, 4], [768, true, 3], [390, false, 3], [390, true, 4]]) {
    window.innerWidth = width;
    coarsePointer = coarse;
    window.dispatchEvent(new window.Event('resize'));
    await quoteTick(window);
    assert.equal(text.clientHeight, lines * 20);
    assert.equal(Boolean(document.querySelector('#mobile-exact .x-clean-ui-quote-toggle')), lines === 3);
  }
});

test('quote toggle expands inline without parent navigation, while quote and media clicks retain native handlers', async (t) => {
  const window = setup(t, post('toggle', '', '本文', quote('interactive', 7, 'video')), 'https://x.com/home', quoteLayout);
  await quoteTick(window);
  const { document } = window;
  const container = document.getElementById('interactive');
  const text = document.getElementById('interactive-text');
  const button = container.querySelector('.x-clean-ui-quote-toggle');
  let parentClicks = 0;
  let mediaClicks = 0;
  let pointerDowns = 0;
  container.addEventListener('click', () => parentClicks++);
  container.addEventListener('pointerdown', () => pointerDowns++);
  document.getElementById('interactive-media').addEventListener('click', () => mediaClicks++);
  document.documentElement.scrollTop = 320;
  button.dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
  const click = new window.MouseEvent('click', { bubbles: true, cancelable: true });
  button.dispatchEvent(click);
  await quoteTick(window);
  assert.equal(click.defaultPrevented, true);
  assert.equal(pointerDowns, 0);
  assert.equal(parentClicks, 0);
  assert.equal(text.classList.contains('x-clean-ui-quote-expanded'), true);
  assert.equal(text.classList.contains('x-clean-ui-quote-clamped'), false);
  assert.equal(button.textContent, '折りたたむ');
  assert.equal(button.getAttribute('aria-expanded'), 'true');
  assert.equal(document.documentElement.scrollTop, 320);
  assert.equal(window.location.pathname, '/home');
  button.click();
  await quoteTick(window);
  assert.equal(text.classList.contains('x-clean-ui-quote-clamped'), true);
  assert.equal(button.textContent, 'さらに表示');
  assert.equal(button.getAttribute('aria-expanded'), 'false');
  assert.equal(parentClicks, 0);
  document.getElementById('interactive-media').click();
  container.click();
  assert.equal(mediaClicks, 1);
  assert.equal(parentClicks, 2);
  assert.equal(text.classList.contains('x-clean-ui-quote-clamped'), true);
});

test('quote toggles stay subtle until interaction, emphasize only the label, and follow late controls and theme changes', async (t) => {
  const window = setup(t, post('appearance', '', '通常の本文', quote('styled-quote', 6)), 'https://x.com/home', quoteLayout);
  const { document } = window;
  await quoteTick(window);
  const button = document.querySelector('#styled-quote .x-clean-ui-quote-toggle');
  const rules = [...document.styleSheets[0].cssRules];
  const baseRule = rules.find((rule) => rule.selectorText === '.x-clean-ui-quote-toggle');
  const interactionRule = rules.find((rule) => rule.selectorText === '.x-clean-ui-quote-toggle:hover, .x-clean-ui-quote-toggle:focus-visible, .x-clean-ui-quote-toggle:active');
  const focusRule = rules.find((rule) => rule.selectorText === '.x-clean-ui-quote-toggle:focus-visible');
  assert.equal(baseRule.style.getPropertyValue('text-decoration'), 'none');
  assert.equal(baseRule.style.getPropertyValue('width'), 'fit-content', 'hover target is the label, not the whole row');
  assert.equal(baseRule.style.getPropertyValue('margin'), '0');
  const desktopSpacing = rules.find((rule) => rule.conditionText === '(min-width: 768px) and (hover: hover) and (pointer: fine)');
  assert.equal(desktopSpacing.cssRules.length, 1);
  assert.equal(desktopSpacing.cssRules[0].selectorText, '.x-clean-ui-quote-toggle');
  assert.equal(desktopSpacing.cssRules[0].style.getPropertyValue('margin-block'), '-2px');
  assert.equal(baseRule.style.getPropertyValue('color'), 'inherit', 'the resting label is neutral, not an accent-colored link');
  assert.equal(baseRule.style.getPropertyValue('opacity'), '0.55');
  assert.equal(baseRule.style.getPropertyValue('font-size'), 'calc(var(--x-clean-ui-quote-toggle-font-size, 1em) * 0.85)');
  assert.equal(baseRule.style.getPropertyValue('display'), 'block', 'touch users can discover the label without hovering');
  assert.equal(interactionRule.style.getPropertyValue('text-decoration'), 'underline');
  assert.equal(interactionRule.style.getPropertyValue('opacity'), '1');
  assert.ok(interactionRule.style.getPropertyValue('color').includes('#1d9bf0'), 'X blue emphasizes interaction without a native control');
  assert.equal(focusRule.style.getPropertyValue('outline'), '2px solid currentColor');

  const originalQuery = document.querySelectorAll.bind(document);
  let scans = 0;
  document.querySelectorAll = (...args) => { scans++; return originalQuery(...args); };
  const native = document.createElement('button');
  native.dataset.testid = 'tweet-text-show-more-link';
  native.textContent = 'さらに表示';
  native.style.cssText = 'font-family: Arial; font-size: 17px; font-weight: 400; font-style: normal; line-height: 24px; letter-spacing: 0.2px;';
  const nativeStyle = document.createElement('style');
  nativeStyle.textContent = '[data-testid="tweet-text-show-more-link"] { color: rgb(29, 155, 240); }';
  document.head.append(nativeStyle);
  const originalHTML = native.outerHTML;
  let nativeClicks = 0;
  native.addEventListener('click', () => nativeClicks++);
  document.getElementById('appearance').append(native);
  await quoteTick(window);
  for (const property of ['color', 'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing']) {
    assert.equal(document.documentElement.style.getPropertyValue(`--x-clean-ui-quote-toggle-${property}`),
      window.getComputedStyle(native).getPropertyValue(property), property);
  }
  assert.equal(native.outerHTML, originalHTML, 'the official control is untouched');
  native.click();
  assert.equal(nativeClicks, 1);
  button.click();
  await quoteTick(window);
  assert.equal(button.textContent, '折りたたむ');
  assert.equal(nativeClicks, 1, 'custom expansion never invokes the official handler');

  const theme = document.createElement('style');
  theme.textContent = '.custom-accent [data-testid="tweet-text-show-more-link"] { color: rgb(255, 122, 0) !important; }';
  document.head.append(theme);
  document.documentElement.classList.add('custom-accent');
  await quoteTick(window);
  assert.equal(document.documentElement.style.getPropertyValue('--x-clean-ui-quote-toggle-color'), 'rgb(255, 122, 0)');
  button.click();
  await quoteTick(window);
  assert.equal(button.textContent, 'さらに表示');
  assert.equal(scans, 0);
});

test('dynamic quote updates are idempotent, reset reused text, respond to width changes and remove stale controls', async (t) => {
  const window = setup(t, post('initial', '', '本文'), 'https://x.com/home', quoteLayout);
  const { document } = window;
  const originalQuery = document.querySelectorAll.bind(document);
  let scans = 0;
  document.querySelectorAll = (...args) => { scans++; return originalQuery(...args); };
  const wrapper = document.createElement('div');
  wrapper.innerHTML = post('added', '', '本文', quote('dynamic', 6));
  document.body.append(wrapper);
  await quoteTick(window);
  const text = document.getElementById('dynamic-text');
  const container = document.getElementById('dynamic');
  const button = container.querySelector('.x-clean-ui-quote-toggle');
  for (let i = 0; i < 3; i++) container.append(document.createElement('span'));
  await quoteTick(window);
  assert.equal(container.querySelectorAll('.x-clean-ui-quote-toggle').length, 1);
  button.click();
  await quoteTick(window);
  assert.equal(button.textContent, '折りたたむ', 'listener is not duplicated');
  text.className = '';
  await quoteTick(window);
  assert.equal(button.textContent, 'さらに表示');
  assert.equal(text.classList.contains('x-clean-ui-quote-clamped'), true);

  text.dataset.testLines = '2';
  text.textContent = '短く更新';
  await quoteTick(window);
  assert.equal(container.querySelector('.x-clean-ui-quote-toggle'), null);
  assert.equal(text.classList.contains('x-clean-ui-quote-clamped'), false);
  text.dataset.testLines = '5';
  window.dispatchEvent(new window.Event('resize'));
  await quoteTick(window);
  assert.equal(container.querySelectorAll('.x-clean-ui-quote-toggle').length, 1);
  container.querySelector('a').remove();
  await quoteTick(window);
  assert.equal(container.querySelector('.x-clean-ui-quote-toggle'), null);
  assert.equal(text.classList.contains('x-clean-ui-quote-text'), false);
  container.insertAdjacentHTML('beforeend', '<div data-testid="videoPlayer"><video controls></video></div>');
  await quoteTick(window);
  assert.equal(container.querySelectorAll('.x-clean-ui-quote-toggle').length, 1, 'late media activates the existing quote text');
  container.removeAttribute('data-testid');
  await quoteTick(window);
  assert.equal(container.querySelector('.x-clean-ui-quote-toggle'), null, 'no longer a quote');

  window.history.pushState({}, '', '/i/lists/123');
  wrapper.innerHTML = post('refreshed', '', '本文', quote('replacement', 5, 'video'));
  await quoteTick(window);
  assert.equal(wrapper.querySelectorAll('.x-clean-ui-quote-toggle').length, 1);
  assert.equal(button.isConnected, false);
  assert.equal(scans, 0);
});

test('generic post links and preview cards are not mistaken for media quotes', async (t) => {
  const window = setup(t, `<div role="link">${post('normal-link', '', '通常の本文', quote('card', 7, 'photo', 'data-testid="card.wrapper" role="link"'))}</div>`,
    'https://x.com/home', quoteLayout);
  const postElement = window.document.getElementById('normal-link');
  const wrapper = window.document.createElement('div');
  wrapper.setAttribute('role', 'link');
  wrapper.innerHTML = '<div data-testid="tweetText" data-test-lines="8">通常の本文を囲むリンク</div><div data-testid="tweetPhoto"><img></div><div role="group"><button data-testid="reply"></button></div>';
  postElement.append(wrapper);
  await quoteTick(window);
  assert.equal(postElement.querySelector('.x-clean-ui-quote-toggle'), null);
  assert.equal(postElement.querySelector('.x-clean-ui-quote-clamped'), null);
});

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

test('timeline action buttons stay visible and clickable while counts remain hidden', (t) => {
  const window = setup(t, post('normal', '', '2026 and 29'));
  const { document } = window;
  for (const type of ['reply', 'retweet', 'like', 'views']) {
    const button = document.getElementById(`normal-${type}`);
    const count = button.querySelector('.x-clean-ui-count');
    assert.ok(count, type);
    assert.equal(window.getComputedStyle(count).visibility, 'hidden');
    assert.equal(window.getComputedStyle(button).visibility, 'visible');
    assert.ok(button.isConnected);
    assert.notEqual(window.getComputedStyle(button).display, 'none');
    const rowStyle = window.getComputedStyle(button.closest('[role="group"]'));
    assert.notEqual(rowStyle.display, 'none');
    assert.notEqual(rowStyle.pointerEvents, 'none');
  }
  let clicks = 0;
  document.getElementById('normal-like').addEventListener('click', () => clicks++);
  document.getElementById('normal-like').click();
  assert.equal(clicks, 1);
  assert.equal(document.querySelector('[data-testid="tweetText"]').textContent, '2026 and 29');
});

test('timeline rows retain their natural spacing while only share is hidden', async (t) => {
  const window = setup(t, `<nav><div role="group" id="nav-group"><button>共有</button></div></nav>` +
    post('row', '', '本文', `<div data-testid="videoPlayer"><div role="group" id="video-controls"><button>再生</button></div></div>
      <div data-testid="quoteTweet"><div role="group" id="quote-controls"><button data-testid="like">引用のボタン</button></div></div>
      <div role="group" id="unrelated-group"><button>翻訳</button></div>`));
  const { document } = window;
  const group = document.getElementById('row-reply').closest('[role="group"]');
  group.style.cssText = 'height:40px;margin-top:12px';
  const share = document.createElement('button');
  share.setAttribute('aria-label', 'ポストを共有');
  group.append(share);
  await tick(window);
  assert.notEqual(window.getComputedStyle(group).display, 'none');
  assert.equal(window.getComputedStyle(group).height, '40px');
  assert.equal(window.getComputedStyle(group).marginTop, '12px');
  assert.notEqual(window.getComputedStyle(group).pointerEvents, 'none');
  assert.equal(window.getComputedStyle(share).display, 'none');
  assert.ok(share.isConnected);
  for (const id of ['nav-group', 'video-controls', 'quote-controls', 'unrelated-group']) {
    assert.notEqual(window.getComputedStyle(document.getElementById(id)).display, 'none', id);
  }
  assert.notEqual(window.getComputedStyle(document.querySelector('[data-testid="tweetText"]')).display, 'none');
});

test('share is visible only for the opened post and stays scoped through SPA and React updates', async (t) => {
  const window = setup(t, statusPost('first', '123') + statusPost('second', '456') +
    '<nav><button aria-label="ポストを共有" id="nav-share"></button></nav>');
  const { document } = window;
  for (const [id, label] of [['first', 'ポストを共有'], ['second', 'Share post']]) {
    const group = document.getElementById(`${id}-like`).closest('[role="group"]');
    group.insertAdjacentHTML('beforeend', `<button aria-label="${label}" id="${id}-share"><svg></svg></button>`);
  }
  document.getElementById('first').insertAdjacentHTML('afterbegin', '<button aria-label="Share" id="header-share"></button>');
  document.getElementById('first').insertAdjacentHTML('beforeend', '<div data-testid="videoPlayer"><div role="group"><button aria-label="ポストを共有" id="video-share"></button></div></div>');
  await tick(window);
  const hidden = (id) => window.getComputedStyle(document.getElementById(id)).display === 'none';
  assert.equal(hidden('first-share'), true);
  assert.equal(hidden('second-share'), true);
  for (const id of ['nav-share', 'header-share', 'video-share', 'first-like', 'first-reply', 'first-bookmark']) {
    assert.equal(hidden(id), false, id);
  }
  const originalQuery = document.querySelectorAll.bind(document);
  let scans = 0;
  document.querySelectorAll = (...args) => { scans++; return originalQuery(...args); };
  window.history.pushState({}, '', '/user/status/123');
  document.body.append(document.createElement('div'));
  await tick(window);
  assert.equal(hidden('first-share'), false);
  assert.equal(hidden('second-share'), true);
  const share = document.getElementById('first-share');
  let clicks = 0;
  share.addEventListener('click', () => clicks++);
  share.click();
  assert.equal(clicks, 1);
  window.history.pushState({}, '', '/user/status/456');
  document.body.append(document.createElement('div'));
  await tick(window);
  assert.equal(hidden('first-share'), true);
  assert.equal(hidden('second-share'), false);
  share.className = '';
  await tick(window);
  assert.equal(hidden('first-share'), true);
  share.setAttribute('aria-label', 'Share profile');
  await tick(window);
  assert.equal(hidden('first-share'), false, 'a reused non-post-share control is restored');
  window.history.replaceState({}, '', '/home');
  window.dispatchEvent(new window.PopStateEvent('popstate'));
  await tick(window);
  assert.equal(hidden('second-share'), true);
  assert.equal(scans, 0);
});

test('only the opened post shows like and bookmark counts; reply counts stay hidden on desktop and mobile detail routes', (t) => {
  for (const url of ['https://x.com/user/status/123', 'https://twitter.com/i/web/status/123']) {
    const window = setup(t, statusPost('parent', '111') + statusPost('opened', '123') + statusPost('reply-post', '456'), url);
    const { document } = window;
    for (const id of ['parent', 'opened', 'reply-post']) {
      for (const type of ['reply', 'like', 'bookmark', 'retweet', 'views']) {
        const action = document.getElementById(`${id}-${type}`);
        const visible = id === 'opened' && ['like', 'bookmark'].includes(type);
        assert.equal(window.getComputedStyle(action.querySelector('span')).visibility, visible ? 'visible' : 'hidden', `${id}-${type}`);
        assert.equal(window.getComputedStyle(action).visibility, 'visible');
        assert.notEqual(window.getComputedStyle(action).display, 'none', `${id}-${type} button`);
        const rowStyle = window.getComputedStyle(action.closest('[role="group"]'));
        assert.notEqual(rowStyle.display, 'none');
        assert.notEqual(rowStyle.pointerEvents, 'none');
      }
    }
    assert.equal(window.getComputedStyle(document.querySelector('#opened-detail-views span span')).visibility, 'hidden');
    assert.equal(window.getComputedStyle(document.querySelector('#opened-bookmark span')).visibility, 'visible');
    assert.equal(window.getComputedStyle(document.querySelector('#opened-body-link span')).visibility, 'visible');
    for (const type of ['like', 'reply']) {
      const action = document.getElementById(`opened-${type}`);
      let clicks = 0;
      action.addEventListener('click', () => clicks++);
      action.click();
      assert.equal(clicks, 1);
    }
  }
});

test('detail count exceptions follow SPA entry, another post, Back and delayed timestamp rendering without document rescans', async (t) => {
  const window = setup(t, statusPost('first', '123') + statusPost('second', '456'));
  const { document } = window;
  const originalQuery = document.querySelectorAll.bind(document);
  let scans = 0;
  document.querySelectorAll = (...args) => { scans++; return originalQuery(...args); };
  const visibility = (id) => window.getComputedStyle(document.querySelector(`#${id}-like span`)).visibility;
  const bookmarkVisibility = (id) => window.getComputedStyle(document.querySelector(`#${id}-bookmark span`)).visibility;
  const replyVisibility = (id) => window.getComputedStyle(document.querySelector(`#${id}-reply span`)).visibility;
  const rowHidden = (id) => window.getComputedStyle(document.getElementById(`${id}-like`)).display === 'none';
  assert.equal(visibility('first'), 'hidden');
  assert.equal(rowHidden('first'), false);
  assert.equal(bookmarkVisibility('first'), 'hidden');
  window.history.pushState({}, '', '/user/status/123');
  document.body.append(document.createElement('div'));
  await tick(window);
  assert.equal(visibility('first'), 'visible');
  assert.equal(rowHidden('first'), false);
  assert.equal(rowHidden('second'), false);
  assert.equal(bookmarkVisibility('first'), 'visible');
  assert.equal(replyVisibility('first'), 'hidden');
  assert.equal(visibility('second'), 'hidden');
  assert.equal(bookmarkVisibility('second'), 'hidden');
  document.getElementById('first-bookmark').setAttribute('data-testid', 'removeBookmark');
  const firstLike = document.getElementById('first-like');
  firstLike.setAttribute('data-testid', 'unlike');
  firstLike.querySelector('span').textContent = '710';
  document.querySelector('#first-reply span').textContent = '30';
  await tick(window);
  assert.equal(visibility('first'), 'visible');
  assert.equal(bookmarkVisibility('first'), 'visible');
  assert.equal(replyVisibility('first'), 'hidden');

  window.history.pushState({}, '', '/user/status/456');
  document.body.append(document.createElement('div'));
  await tick(window);
  assert.equal(visibility('first'), 'hidden');
  assert.equal(bookmarkVisibility('first'), 'hidden');
  assert.equal(visibility('second'), 'visible');
  assert.equal(rowHidden('first'), false);
  assert.equal(rowHidden('second'), false);
  assert.equal(bookmarkVisibility('second'), 'visible');
  assert.equal(replyVisibility('second'), 'hidden');
  window.history.replaceState({}, '', '/home');
  window.dispatchEvent(new window.PopStateEvent('popstate'));
  await tick(window);
  assert.equal(visibility('second'), 'hidden');
  assert.equal(rowHidden('second'), false);
  assert.equal(bookmarkVisibility('second'), 'hidden');

  window.history.pushState({}, '', '/user/status/789');
  const wrapper = document.createElement('div');
  wrapper.innerHTML = post('delayed', '');
  document.body.append(wrapper);
  await tick(window);
  assert.equal(visibility('delayed'), 'hidden');
  assert.equal(rowHidden('delayed'), false);
  document.getElementById('delayed').insertAdjacentHTML('afterbegin', '<a href="/user/status/789"><time>時刻</time></a>');
  await tick(window);
  assert.equal(visibility('delayed'), 'visible');
  assert.equal(rowHidden('delayed'), false);
  const row = document.getElementById('delayed-like').closest('[role="group"]');
  window.history.replaceState({}, '', '/home');
  window.dispatchEvent(new window.PopStateEvent('popstate'));
  await tick(window);
  row.className = '';
  await tick(window);
  assert.equal(rowHidden('delayed'), false, 'React class rewrite');
  assert.notEqual(window.getComputedStyle(row).pointerEvents, 'none');
  assert.equal(scans, 0);
});

test('hides only the post menu and Explain this post controls, not other More or Grok UI', (t) => {
  const window = setup(t, `
    <nav><button data-testid="caret" id="nav-more">もっと見る</button></nav>
    <button aria-label="このポストを説明する" id="outside-explain"></button>
    ${post('controls', `
      <div data-testid="User-Name"><span>Author</span>
        <div data-testid="caret" role="button" id="post-more">•••</div>
        <button aria-label="このポストを説明する" id="post-explain"></button>
        <button aria-label="Share" id="post-share"></button>
      </div>`, 'もっと見る と このポストを説明する は本文の文字列', `
      <a id="expand" href="/status/123">さらに表示</a>
      <div data-testid="card.wrapper"><button aria-label="Explain this post" id="media-control"></button></div>
      <div role="group"><button data-testid="caret" id="action-caret"></button></div>
      <button id="nested-label"><svg aria-label="Explain this post"></svg></button>`)}
    ${post('english', '<div role="button" title="Explain this post" id="english-explain"></div>')}`);
  const { document } = window;
  for (const id of ['post-more', 'post-explain', 'english-explain']) {
    assert.equal(window.getComputedStyle(document.getElementById(id)).display, 'none', id);
    assert.ok(document.getElementById(id).isConnected);
  }
  for (const id of ['nav-more', 'outside-explain', 'post-share', 'expand', 'media-control', 'action-caret', 'nested-label']) {
    assert.notEqual(window.getComputedStyle(document.getElementById(id)).display, 'none', id);
  }
  assert.match(document.querySelector('[data-testid="tweetText"]').textContent, /もっと見る/);
});

test('new post controls and React updates stay scoped to the changed post', async (t) => {
  const window = setup(t, post('original', ''));
  const { document } = window;
  const originalQuery = document.querySelectorAll.bind(document);
  let fullScans = 0;
  document.querySelectorAll = (...args) => { fullScans++; return originalQuery(...args); };

  const added = document.createElement('div');
  added.innerHTML = post('later', '<button data-testid="caret" id="later-more"></button>');
  document.body.append(added);
  await tick(window);
  assert.equal(window.getComputedStyle(document.getElementById('later-more')).display, 'none');
  const explain = document.createElement('button');
  explain.setAttribute('aria-label', 'Explain this post');
  document.getElementById('later').prepend(explain);
  await tick(window);
  assert.equal(window.getComputedStyle(explain).display, 'none');
  explain.className = '';
  await tick(window);
  assert.equal(window.getComputedStyle(explain).display, 'none', 'class rewrite');
  explain.setAttribute('aria-label', 'Share');
  await tick(window);
  assert.notEqual(window.getComputedStyle(explain).display, 'none', 'other button restored');
  assert.equal(fullScans, 0);
});

test('Grok actions in a post header is hidden when its Japanese tooltip is separate', async (t) => {
  const window = setup(t, `
    <button aria-label="Grok actions" id="outside-grok"></button>
    <div role="tooltip">このポストを説明する</div>
    ${post('grok', `<div data-testid="User-Name">
      <button aria-label="Grok actions" id="post-grok"><svg></svg></button>
    </div>`, '本文中のGrok actionsは残る', `
      <div role="group"><button aria-label="Grok actions" id="footer-grok"></button></div>
      <div data-testid="card.wrapper"><button aria-label="Grok actions" id="card-grok"></button></div>`)}`);
  const { document } = window;
  const button = document.getElementById('post-grok');
  assert.equal(window.getComputedStyle(button).display, 'none');
  assert.ok(button.isConnected);
  for (const id of ['outside-grok', 'footer-grok', 'card-grok']) {
    assert.notEqual(window.getComputedStyle(document.getElementById(id)).display, 'none', id);
  }
  button.setAttribute('aria-label', 'Share');
  await tick(window);
  assert.notEqual(window.getComputedStyle(button).display, 'none');
});

test('the captured Japanese Grok action button is hidden only within posts', (t) => {
  const button = (id) => `<button id="${id}" aria-label="Grokのアクション" role="button" type="button"><div><svg viewBox="0 0 33 32" aria-hidden="true"><g><path d="M12.745 20.54"></path></g></svg></div></button>`;
  const window = setup(t, `<nav>${button('nav-grok')}</nav><div data-testid="GrokDrawer">${button('drawer-grok')}</div>` +
    post('jp-grok', button('post-jp-grok'), 'Grokのアクション', `<div data-testid="card.wrapper">${button('card-jp-grok')}</div>`));
  const { document } = window;
  assert.equal(window.getComputedStyle(document.getElementById('post-jp-grok')).display, 'none');
  assert.ok(document.getElementById('post-jp-grok').isConnected);
  for (const id of ['nav-grok', 'drawer-grok', 'card-jp-grok']) {
    assert.notEqual(window.getComputedStyle(document.getElementById(id)).display, 'none', id);
  }
  assert.equal(document.querySelector('[data-testid="tweetText"]').textContent, 'Grokのアクション');
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
