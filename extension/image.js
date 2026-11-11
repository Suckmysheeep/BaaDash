// Generic images: only URLs already exposed by the current page. No crawling,
// pagination, request interception or site-specific selectors to maintain.
(() => {
  if (/(^|\.)pixiv\.net$/i.test(location.hostname)) return;
  const ui = window.__baadashImageUI;
  ui?.attach(async (img) => {
    const item = ui.directItem(img);
    return item ? [item] : [];
  });
})();
