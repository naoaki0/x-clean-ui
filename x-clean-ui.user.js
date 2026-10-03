// ==UserScript==
// @name         x-clean-UI
// @namespace    https://x.com/
// @version      0.8.9
// @description  Simplify X posts and open the first visible custom Home timeline.
// @match        https://x.com/*
// @match        https://twitter.com/*
// @updateURL    https://naoaki0.github.io/x-clean-ui/x-clean-ui.meta.js
// @downloadURL  https://naoaki0.github.io/x-clean-ui/x-clean-ui.user.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(() => {
  'use strict';

  const actionSelector = [
    '[data-testid="reply"]',
    '[data-testid="retweet"]',
    '[data-testid="unretweet"]',
    '[data-testid="like"]',
    '[data-testid="unlike"]',
    '[data-testid="viewCount"]',
    '[data-testid="bookmark"]',
    '[data-testid="removeBookmark"]',
    'a[href*="/analytics"]',
  ].join(',');
  const postSelector = 'article[data-testid="tweet"]';
  const homeTabSelector = '[role="tablist"] [role="tab"]';
  const countClass = 'x-clean-ui-count';
  const adClass = 'x-clean-ui-ad';
  const homeTabClass = 'x-clean-ui-home-tab';
  const postControlClass = 'x-clean-ui-post-control';
  const shareClass = 'x-clean-ui-share';
  const quoteSelector = '[data-testid="quoteTweet"], [role="link"]';
  const quoteMediaSelector = '[data-testid="tweetPhoto"], [data-testid="videoPlayer"], [data-testid="videoComponent"], video';
  const quoteTextClass = 'x-clean-ui-quote-text';
  const quoteClampClass = 'x-clean-ui-quote-clamped';
  const quoteExpandedClass = 'x-clean-ui-quote-expanded';
  const quoteToggleClass = 'x-clean-ui-quote-toggle';
  const nativeMoreSelector = '[data-testid="tweet-text-show-more-link"]';
  const defaultTabLabels = new Set(['おすすめ', 'フォロー中', 'For you', 'Following']);
  const explainPostLabel = /^(?:このポストを説明する|Explain this post|Grok actions|Grokのアクション)$/i;
  const sharePostLabel = /^(?:ポストを共有|共有|Share post|Share)$/i;
  const adLabel = /^(?:Promoted|Sponsored|広告)$/i;
  const contentSelector = '[data-testid="tweetText"], [data-testid="quoteTweet"], [data-testid="card.wrapper"], [data-testid="media-container"], [data-testid="tweetPhoto"], [data-testid="videoPlayer"]';
  const countPattern = /^[\s\d\u0660-\u0669\u06f0-\u06f9\uff10-\uff19]+(?:[.,，٫٬\s]*[\d\u0660-\u0669\u06f0-\u06f9\uff10-\uff19]+)*(?:[KMBTkmbt万千億])?\s*$/;
  const style = document.createElement('style');
  style.textContent = `.${countClass} { visibility: hidden !important; }
${postSelector}.${adClass}, [role="tab"].${homeTabClass}, .${postControlClass}, .${shareClass} { display: none !important; }
.${quoteClampClass} { display: -webkit-box !important; -webkit-box-orient: vertical !important; -webkit-line-clamp: 3 !important; line-clamp: 3; overflow: hidden !important; }
@media (max-width: 767px) and (pointer: coarse) { .${quoteClampClass} { -webkit-line-clamp: 4 !important; line-clamp: 4; } }
.${quoteExpandedClass} { display: block !important; -webkit-line-clamp: unset !important; line-clamp: unset; max-height: none !important; overflow: visible !important; }
.${quoteToggleClass} { appearance: none; border: 0; border-radius: 0; background: none; color: inherit; opacity: 0.55; font: inherit; font-family: var(--x-clean-ui-quote-toggle-font-family, inherit); font-size: calc(var(--x-clean-ui-quote-toggle-font-size, 1em) * 0.85); font-weight: var(--x-clean-ui-quote-toggle-font-weight, inherit); font-style: var(--x-clean-ui-quote-toggle-font-style, inherit); line-height: var(--x-clean-ui-quote-toggle-line-height, inherit); letter-spacing: var(--x-clean-ui-quote-toggle-letter-spacing, inherit); padding: 0; margin: 0; display: block; width: fit-content; align-self: flex-start; text-align: start; text-decoration: none; cursor: pointer; }
.${quoteToggleClass}:hover, .${quoteToggleClass}:focus-visible, .${quoteToggleClass}:active { color: var(--x-clean-ui-quote-toggle-color, #1d9bf0); opacity: 1; text-decoration: underline; }
.${quoteToggleClass}:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }`;
  (document.head || document.documentElement).appendChild(style);
  const pageLocation = window.location;
  const knownPosts = new Set();
  const quoteStates = new WeakMap();
  const quoteTexts = new Set();
  const pendingQuoteTexts = new Set();
  const nextFrame = window.requestAnimationFrame ? window.requestAnimationFrame.bind(window) : (callback) => window.setTimeout(callback, 0);
  let quoteFrame = null;
  let quoteAppearanceFrame = null;
  let nativeMoreControl = null;
  const quoteResizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver((entries) => {
    for (const { target } of entries) {
      const state = quoteStates.get(target);
      if (state && (target.getBoundingClientRect().width !== state.width || target.clientHeight !== state.height)) {
        state.needsMeasure = true;
        scheduleQuoteText(target);
      }
    }
  }) : null;
  let homeTabList = null;
  let lastPath = pageLocation.pathname;
  let pendingTab = null;
  let homeCheckTimer = null;

  function isHome() {
    return pageLocation.pathname === '/home' || pageLocation.pathname === '/';
  }

  function isDefaultTab(tab) {
    // A list URL identifies a custom timeline even if its name matches a default.
    const href = tab.getAttribute('href') || tab.querySelector('a[href]')?.getAttribute('href') || '';
    if (/(?:^|\/)(?:i\/)?lists\/\d+(?:[/?#]|$)/.test(href)) return false;
    const label = tab.textContent.replace(/\s+/g, ' ').trim() || (tab.getAttribute('aria-label') || '').trim();
    return defaultTabLabels.has(label);
  }

  function isHomeTimelineList(list) {
    if (!isHome() || !list) return false;
    if (list.closest('[data-testid="primaryColumn"]')) return true;
    // On mobile the home tablist can live outside main/primaryColumn. Require
    // both standard tabs so an unrelated tablist cannot be mistaken for Home.
    const labels = new Set([...list.querySelectorAll('[role="tab"]')]
      .filter((tab) => tab.closest('[role="tablist"]') === list && isDefaultTab(tab))
      .map((tab) => tab.textContent.replace(/\s+/g, ' ').trim() || (tab.getAttribute('aria-label') || '').trim()));
    return (labels.has('おすすめ') && labels.has('フォロー中')) ||
      (labels.has('For you') && labels.has('Following'));
  }

  function openFirstCustomTimeline() {
    if (!isHome() || !homeTabList?.isConnected) return;
    const tabs = [...homeTabList.querySelectorAll('[role="tab"]')]
      .filter((tab) => tab.closest('[role="tablist"]') === homeTabList);
    const selected = tabs.find((tab) => tab.getAttribute('aria-selected') === 'true');
    // Wait until X has rendered both a selected tab and at least one custom tab.
    if (!selected) return;
    const custom = tabs.filter((tab) => !isDefaultTab(tab) &&
      !tab.hasAttribute('disabled') && tab.getAttribute('aria-disabled') !== 'true');
    if (custom.includes(selected)) {
      pendingTab = null;
      return;
    }
    const first = custom[0];
    if (first && pendingTab !== first) {
      pendingTab = first;
      first.click();
    }
  }

  function scheduleHomeCheck() {
    if (homeCheckTimer !== null) return;
    homeCheckTimer = window.setTimeout(() => {
      homeCheckTimer = null;
      openFirstCustomTimeline();
    }, 0);
  }

  function syncHomeTab(tab) {
    if (!tab.isConnected) return;
    const list = tab.closest('[role="tablist"]');
    const isTimeline = isHomeTimelineList(list);
    if (isTimeline && homeTabList !== list) {
      homeTabList = list;
      // A mobile tablist may gain its second standard tab after the first was
      // processed. Recheck only this tablist when it becomes identifiable.
      for (const sibling of list.querySelectorAll('[role="tab"]')) {
        if (sibling.closest('[role="tablist"]') === list) {
          sibling.classList.toggle(homeTabClass, isDefaultTab(sibling));
        }
      }
    }
    tab.classList.toggle(homeTabClass, !!(isTimeline && isDefaultTab(tab)));
  }

  function isAdLabel(element, post) {
    return element && element.closest(postSelector) === post &&
      !element.closest(`a, button, [role="link"], [role="button"], [role="group"], ${contentSelector}`) &&
      (adLabel.test((element.getAttribute('aria-label') || '').trim()) ||
        adLabel.test(element.textContent.replace(/\s+/g, ' ').trim()));
  }

  function isAd(post) {
    // placementTracking also occurs on ordinary media, so never use it alone.
    if (adLabel.test((post.getAttribute('aria-label') || '').trim())) return true;
    for (const marker of post.querySelectorAll('[data-testid="promotedIndicator"], [data-testid="promotedTweet"]')) {
      if (marker.closest(postSelector) === post) return true;
    }

    for (const id of (post.getAttribute('aria-labelledby') || '').split(/\s+/)) {
      if (id && isAdLabel(document.getElementById(id), post)) return true;
    }
    for (const label of post.querySelectorAll('[aria-label]')) {
      if (isAdLabel(label, post) && adLabel.test((label.getAttribute('aria-label') || '').trim())) return true;
    }

    // A standalone label in the post header is enough: real ads may not have
    // placementTracking or aria-labelledby. Never inspect the post body itself.
    const content = post.querySelector(contentSelector);
    for (const label of post.querySelectorAll('span')) {
      if (isAdLabel(label, post) &&
          (!content || (label.compareDocumentPosition(content) & Node.DOCUMENT_POSITION_FOLLOWING))) {
        return true;
      }
    }
    return false;
  }

  function syncPost(post) {
    if (!post.isConnected) {
      knownPosts.delete(post);
      return;
    }
    knownPosts.add(post);
    post.classList.toggle(adClass, isAd(post));

    const controls = new Map();
    for (const marker of post.querySelectorAll(`[data-testid="caret"], [aria-label], [title], .${postControlClass}`)) {
      const control = marker.closest('button, [role="button"]');
      if (!control || control.closest(postSelector) !== post) continue;
      // Read the control's own label, not text/labels inside post content.
      const label = control.getAttribute('aria-label') || control.getAttribute('title') || '';
      controls.set(control, controls.get(control) || marker.matches('[data-testid="caret"]') ||
        explainPostLabel.test(label.trim()));
    }
    for (const [control, target] of controls) {
      control.classList.toggle(postControlClass, !!(target &&
        !control.closest(`[role="group"], ${contentSelector}`)));
    }
    const opened = isOpenedPost(post);
    for (const control of post.querySelectorAll(`button, [role="button"], .${shareClass}`)) {
      if (control.closest(postSelector) !== post) continue;
      const label = control.getAttribute('aria-label') || control.getAttribute('title') || '';
      const isShare = control.matches('button, [role="button"]') &&
        sharePostLabel.test(label.trim()) && isPostAction(control);
      control.classList.toggle(shareClass, !!(isShare && !opened));
    }
    // A timestamp/self-link can arrive after the action buttons render.
    for (const action of post.querySelectorAll(actionSelector)) syncAction(action);
    syncQuotes(post);
  }

  function scheduleQuoteText(text) {
    pendingQuoteTexts.add(text);
    if (quoteFrame !== null) return;
    quoteFrame = nextFrame(() => {
      quoteFrame = null;
      const texts = [...pendingQuoteTexts];
      pendingQuoteTexts.clear();
      for (const text of texts) {
        const state = quoteStates.get(text);
        if (state) renderQuoteText(state);
      }
    });
  }

  function collectNativeMore(root) {
    if (root.nodeType !== Node.ELEMENT_NODE) return;
    const control = root.matches(nativeMoreSelector) ? root : root.querySelector(nativeMoreSelector);
    if (control?.isConnected) nativeMoreControl = control;
  }

  function scheduleQuoteAppearance() {
    if (!nativeMoreControl?.isConnected || quoteAppearanceFrame !== null) return;
    quoteAppearanceFrame = nextFrame(() => {
      quoteAppearanceFrame = null;
      if (!nativeMoreControl?.isConnected) return;
      const nativeStyle = window.getComputedStyle(nativeMoreControl);
      if (nativeStyle.display === 'none' || nativeStyle.visibility === 'hidden') return;
      // Use X's live "Show more" color and typography, including custom themes.
      // Only copy presentation; never clone its navigation or event handlers.
      for (const property of ['color', 'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing']) {
        const value = nativeStyle.getPropertyValue(property);
        const name = `--x-clean-ui-quote-toggle-${property}`;
        if (value && document.documentElement.style.getPropertyValue(name) !== value) {
          document.documentElement.style.setProperty(name, value);
        }
      }
    });
  }

  function removeQuoteText(text) {
    const state = quoteStates.get(text);
    if (!state) return;
    state.button.remove();
    text.classList.remove(quoteTextClass, quoteClampClass, quoteExpandedClass);
    quoteResizeObserver?.unobserve(text);
    quoteStates.delete(text);
    quoteTexts.delete(text);
    pendingQuoteTexts.delete(text);
  }

  function removeQuotesIn(root) {
    if (root.nodeType !== Node.ELEMENT_NODE) return;
    removeQuoteText(root);
    for (const text of root.querySelectorAll(`[data-testid="tweetText"], .${quoteTextClass}`)) removeQuoteText(text);
  }

  function renderQuoteText(state) {
    const { text, button } = state;
    if (!text.isConnected) {
      removeQuoteText(text);
      return;
    }
    if (!text.classList.contains(quoteTextClass)) text.classList.add(quoteTextClass);
    if (state.needsMeasure) {
      // Measure the actual clamped box (four lines on mobile), not a character-count estimate.
      // Expanded text is briefly measured collapsed and restored before paint.
      text.classList.remove(quoteExpandedClass);
      text.classList.add(quoteClampClass);
      state.overflow = text.clientHeight > 0 && text.scrollHeight > text.clientHeight + 1;
      state.needsMeasure = false;
    }
    if (!state.overflow) state.expanded = false;
    text.classList.toggle(quoteClampClass, state.overflow && !state.expanded);
    text.classList.toggle(quoteExpandedClass, state.overflow && state.expanded);
    state.width = text.getBoundingClientRect().width;
    state.height = text.clientHeight;
    if (!state.overflow) {
      button.remove();
      return;
    }
    const label = state.expanded ? '折りたたむ' : 'さらに表示';
    if (button.textContent !== label) button.textContent = label;
    button.setAttribute('aria-expanded', String(state.expanded));
    if (text.nextSibling !== button) text.after(button);
  }

  function toggleQuoteText(event, state) {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!state.overflow || !state.text.isConnected) return;
    const top = state.text.getBoundingClientRect().top;
    let scroller = state.text.parentElement;
    while (scroller && !(/auto|scroll/.test(window.getComputedStyle(scroller).overflowY) && scroller.scrollHeight > scroller.clientHeight)) {
      scroller = scroller.parentElement;
    }
    scroller ||= document.scrollingElement || document.documentElement;
    const scrollTop = scroller.scrollTop;
    state.expanded = !state.expanded;
    renderQuoteText(state);
    scroller.scrollTop = scrollTop;
    // Compensate native scroll anchoring using the unchanged top of the text.
    nextFrame(() => {
      if (state.text.isConnected) {
        const delta = state.text.getBoundingClientRect().top - top;
        if (Math.abs(delta) > 1) scroller.scrollTop += delta;
      }
    });
  }

  function syncQuotes(post) {
    const eligible = new Set();
    for (const quote of post.querySelectorAll(quoteSelector)) {
      if (quote.matches(postSelector) || quote.closest(postSelector) !== post ||
          quote.closest('[data-testid="tweetText"], [data-testid="card.wrapper"], [data-testid="tweetPhoto"], [data-testid="videoPlayer"]')) continue;
      if (!quote.matches('[data-testid="quoteTweet"]') &&
          (quote.querySelector(postSelector) || [...quote.querySelectorAll(actionSelector)].some(isPostAction))) continue;
      const hasMedia = [...quote.querySelectorAll(quoteMediaSelector)].some((media) => closestQuote(media) === quote);
      if (!hasMedia) continue;
      for (const text of quote.querySelectorAll('[data-testid="tweetText"]')) {
        if (closestQuote(text) !== quote || text.closest(postSelector) !== post) continue;
        eligible.add(text);
        let state = quoteStates.get(text);
        const content = text.innerHTML;
        const source = quote.getAttribute('href') || quote.querySelector('a[href*="/status/"]')?.getAttribute('href') || '';
        if (!state) {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = quoteToggleClass;
          state = { text, button, content, source, expanded: false, overflow: false, needsMeasure: true };
          quoteStates.set(text, state);
          quoteTexts.add(text);
          button.addEventListener('click', (event) => toggleQuoteText(event, state));
          for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend']) {
            button.addEventListener(type, (event) => event.stopPropagation());
          }
          for (const type of ['keydown', 'keyup']) {
            button.addEventListener(type, (event) => {
              if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
            });
          }
          quoteResizeObserver?.observe(text);
        } else if (state.content !== content || state.source !== source || !text.classList.contains(quoteTextClass)) {
          state.content = content;
          state.source = source;
          state.expanded = false;
          state.needsMeasure = true;
        }
        scheduleQuoteText(text);
      }
    }
    for (const text of post.querySelectorAll(`.${quoteTextClass}`)) {
      if (text.closest(postSelector) === post && !eligible.has(text)) removeQuoteText(text);
    }
  }

  function closestQuote(element) {
    let quote = element.closest(quoteSelector);
    // Media/author links inside a quote also have role=link, but no quote text.
    while (quote && !quote.matches('[data-testid="quoteTweet"]') && !quote.querySelector('[data-testid="tweetText"]')) {
      quote = quote.parentElement?.closest(quoteSelector);
    }
    return quote;
  }

  function remeasureQuotes() {
    scheduleQuoteAppearance();
    for (const text of quoteTexts) {
      if (!text.isConnected) {
        removeQuoteText(text);
        continue;
      }
      quoteStates.get(text).needsMeasure = true;
      scheduleQuoteText(text);
    }
  }

  window.addEventListener('resize', remeasureQuotes);
  document.fonts?.ready.then(remeasureQuotes);
  document.fonts?.addEventListener('loadingdone', remeasureQuotes);

  function statusId(path) {
    return path.match(/^\/(?:[^/]+\/status|i\/web\/status)\/(\d+)\/?$/)?.[1] || null;
  }

  function isOpenedPost(post) {
    const id = statusId(pageLocation.pathname);
    if (!id) return false;
    // Match the post's own timestamp, not quoted links, media or thread order.
    for (const time of post.querySelectorAll('a[href] time')) {
      if (time.closest(postSelector) !== post || time.closest(contentSelector)) continue;
      const link = time.closest('a[href]');
      const url = new URL(link.href, pageLocation.href);
      if (url.origin === pageLocation.origin && statusId(url.pathname) === id) return true;
    }
    return false;
  }

  function isPostAction(action) {
    const post = action.closest(postSelector);
    const group = action.closest('[role="group"]');
    if (!post || action.closest(contentSelector)) return false;

    if (action.matches('a[href*="/analytics"]')) {
      return !action.querySelector('time') &&
        /(?:^|\/)status\/\d+\/analytics\/?(?:[?#]|$)/.test(action.getAttribute('href') || '');
    }
    return !!(group && group.closest(postSelector) === post);
  }

  function syncAction(action) {
    if (!action.isConnected || !isPostAction(action)) return;
    const opened = isOpenedPost(action.closest(postSelector));
    const bookmark = action.matches('[data-testid="bookmark"], [data-testid="removeBookmark"]');
    const show = opened && (bookmark || action.matches('[data-testid="like"], [data-testid="unlike"]'));
    const hide = !show;

    // X normally gives the animated count a dedicated container. Only use it
    // when its contents are a count; never hide the whole action or its icon.
    const transition = action.querySelector('[data-testid="app-text-transition-container"]');
    const candidates = transition ? [transition] : action.querySelectorAll('span');
    for (const element of candidates) {
      if (element.querySelector('svg, button, a, [role="button"]')) continue;
      if (countPattern.test(element.textContent.trim())) {
        element.classList.toggle(countClass, hide);
        break;
      }
    }

    // React may reuse a count element for non-count text.
    for (const element of action.querySelectorAll(`.${countClass}`)) {
      if (!hide || !countPattern.test(element.textContent.trim())) element.classList.remove(countClass);
    }
  }

  function collectClosest(node, actions, posts, tabs) {
    const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    if (!element) return;

    const action = element.closest(actionSelector);
    if (action) actions.add(action);
    const post = element.closest(postSelector);
    if (post) posts.add(post);
    const tab = element.closest(homeTabSelector);
    if (tab) tabs.add(tab);
  }

  function collectAdded(node, actions, posts, tabs) {
    collectClosest(node, actions, posts, tabs);
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const element = node;
    collectNativeMore(element);
    for (const descendant of element.querySelectorAll(actionSelector)) actions.add(descendant);
    for (const descendant of element.querySelectorAll(postSelector)) posts.add(descendant);
    for (const descendant of element.querySelectorAll(homeTabSelector)) tabs.add(descendant);
  }

  // One initial scan; all subsequent scans are restricted to changed subtrees.
  collectNativeMore(document.documentElement);
  scheduleQuoteAppearance();
  for (const tab of document.querySelectorAll(homeTabSelector)) syncHomeTab(tab);
  if (homeTabList) scheduleHomeCheck();
  for (const post of document.querySelectorAll(postSelector)) syncPost(post);
  for (const action of document.querySelectorAll(actionSelector)) syncAction(action);

  const observer = new MutationObserver((records) => {
    const actions = new Set();
    const posts = new Set();
    const tabs = new Set();
    for (const record of records) {
      if (record.type === 'childList') {
        for (const node of record.addedNodes) collectAdded(node, actions, posts, tabs);
        for (const node of record.removedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          if (!node.isConnected) removeQuotesIn(node);
          knownPosts.delete(node);
          for (const post of node.querySelectorAll(postSelector)) knownPosts.delete(post);
        }
        // A removed/replaced count can change which number is visible.
        if (record.removedNodes.length) collectClosest(record.target, actions, posts, tabs);
      } else if (record.type === 'characterData') {
        collectClosest(record.target, actions, posts, tabs);
      } else if (!record.target.classList.contains(countClass) || record.attributeName !== 'class') {
        collectClosest(record.target, actions, posts, tabs);
      }
    }
    const pathChanged = pageLocation.pathname !== lastPath;
    if (pathChanged) {
      lastPath = pageLocation.pathname;
      pendingTab = null;
      // Route changes are rare; recheck tracked posts, not the whole document.
      for (const post of knownPosts) posts.add(post);
      if (homeTabList && homeTabList.isConnected) {
        for (const tab of homeTabList.querySelectorAll('[role="tab"]')) tabs.add(tab);
      }
    }
    for (const tab of tabs) syncHomeTab(tab);
    if (tabs.size || pathChanged) scheduleHomeCheck();
    for (const post of posts) syncPost(post);
    for (const action of actions) syncAction(action);
    scheduleQuoteAppearance();
  });

  observer.observe(document.documentElement, {
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['class', 'data-testid', 'href', 'role', 'aria-label', 'aria-labelledby', 'aria-selected', 'aria-disabled', 'title', 'id'],
    subtree: true,
  });

  window.addEventListener('popstate', () => {
    if (pageLocation.pathname !== lastPath) {
      pendingTab = null;
      for (const post of knownPosts) syncPost(post);
    }
    if (homeTabList && homeTabList.isConnected) {
      for (const tab of homeTabList.querySelectorAll('[role="tab"]')) syncHomeTab(tab);
    }
    lastPath = pageLocation.pathname;
    scheduleHomeCheck();
  });
})();
