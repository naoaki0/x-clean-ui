// ==UserScript==
// @name         x-clean-UI
// @namespace    https://x.com/
// @version      0.4.2
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
    'a[href*="/analytics"]',
  ].join(',');
  const postSelector = 'article[data-testid="tweet"]';
  const homeTabSelector = '[role="tablist"] [role="tab"]';
  const countClass = 'x-clean-ui-count';
  const adClass = 'x-clean-ui-ad';
  const homeTabClass = 'x-clean-ui-home-tab';
  const defaultTabLabels = new Set(['おすすめ', 'フォロー中', 'For you', 'Following']);
  const adLabel = /^(?:Promoted|Sponsored|広告)$/i;
  const contentSelector = '[data-testid="tweetText"], [data-testid="quoteTweet"], [data-testid="card.wrapper"], [data-testid="media-container"], [data-testid="tweetPhoto"], [data-testid="videoPlayer"]';
  const countPattern = /^[\s\d\u0660-\u0669\u06f0-\u06f9\uff10-\uff19]+(?:[.,，٫٬\s]*[\d\u0660-\u0669\u06f0-\u06f9\uff10-\uff19]+)*(?:[KMBTkmbt万千億])?\s*$/;
  const style = document.createElement('style');
  style.textContent = `.${countClass} { visibility: hidden !important; }
${postSelector}.${adClass}, [role="tab"].${homeTabClass} { display: none !important; }`;
  (document.head || document.documentElement).appendChild(style);
  const pageLocation = window.location;
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
    if (post.isConnected) post.classList.toggle(adClass, isAd(post));
  }

  function isPostAction(action) {
    const post = action.closest(postSelector);
    const group = action.closest('[role="group"]');
    if (!post || !group || group.closest(postSelector) !== post) return false;

    if (action.matches('a[href*="/analytics"]')) {
      return /(?:^|\/)status\/\d+\/analytics\/?(?:[?#]|$)/.test(action.getAttribute('href') || '');
    }
    return true;
  }

  function syncAction(action) {
    if (!action.isConnected || !isPostAction(action)) return;

    // X normally gives the animated count a dedicated container. Only use it
    // when its contents are a count; never hide the whole action or its icon.
    const transition = action.querySelector('[data-testid="app-text-transition-container"]');
    const candidates = transition ? [transition] : action.querySelectorAll('span');
    for (const element of candidates) {
      if (element.querySelector('svg, button, a, [role="button"]')) continue;
      if (countPattern.test(element.textContent.trim())) {
        element.classList.add(countClass);
        break;
      }
    }

    // React may reuse a count element for non-count text.
    for (const element of action.querySelectorAll(`.${countClass}`)) {
      if (!countPattern.test(element.textContent.trim())) element.classList.remove(countClass);
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
    for (const descendant of element.querySelectorAll(actionSelector)) actions.add(descendant);
    for (const descendant of element.querySelectorAll(postSelector)) posts.add(descendant);
    for (const descendant of element.querySelectorAll(homeTabSelector)) tabs.add(descendant);
  }

  // One initial scan; all subsequent scans are restricted to changed subtrees.
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
      if (homeTabList && homeTabList.isConnected) {
        for (const tab of homeTabList.querySelectorAll('[role="tab"]')) tabs.add(tab);
      }
    }
    for (const tab of tabs) syncHomeTab(tab);
    if (tabs.size || pathChanged) scheduleHomeCheck();
    for (const post of posts) syncPost(post);
    for (const action of actions) syncAction(action);
  });

  observer.observe(document.documentElement, {
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['class', 'data-testid', 'href', 'role', 'aria-label', 'aria-labelledby', 'aria-selected', 'aria-disabled', 'id'],
    subtree: true,
  });

  window.addEventListener('popstate', () => {
    if (pageLocation.pathname !== lastPath) pendingTab = null;
    if (homeTabList && homeTabList.isConnected) {
      for (const tab of homeTabList.querySelectorAll('[role="tab"]')) syncHomeTab(tab);
    }
    lastPath = pageLocation.pathname;
    scheduleHomeCheck();
  });
})();
