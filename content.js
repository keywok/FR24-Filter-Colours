// Inject into page context so it can access window.google and window.fetch
const s = document.createElement('script');
s.src = chrome.runtime.getURL('injected.js');
(document.head || document.documentElement).appendChild(s);

// Read FR24 filters from server-rendered page state and cache in storage for the popup
function tryReadFilters() {
  const el = document.querySelector('#app[data-page]');
  if (!el) return false;
  try {
    const data    = JSON.parse(el.dataset.page);
    const filters = data.props.dispatcher.filters.filters.map(f => ({
      id:         f.id,
      name:       f.name,
      enabled:    f.enabled,
      hasAirport: f.conditions.some(c => c.type === 'Airport'),
    }));
    chrome.storage.local.set({ fr24Filters: filters }); // ponytail: fr24Filters stays local — re-populated from page on each visit

    const airportCodes = [...new Set(
      data.props.dispatcher.filters.filters
        .filter(f => f.enabled)
        .flatMap(f => f.conditions.filter(c => c.type === 'Airport').map(c => c.value))
    )];
    document.documentElement.dataset.fr24airports = JSON.stringify(airportCodes);
    return true;
  } catch (e) { return false; }
}

if (!tryReadFilters()) {
  const obs = new MutationObserver(() => { if (tryReadFilters()) obs.disconnect(); });
  obs.observe(document, { childList: true, subtree: true });
}

chrome.runtime.onMessage.addListener(msg => {
  if (msg.type === 'refreshFilters') {
    tryReadFilters();
    document.documentElement.dataset.fr24refreshsig = Date.now();
  }
});

// Push groups + assignments config to injected.js via dataset attributes
function pushConfig() {
  chrome.storage.sync.get({ groups: [], assignments: {}, showAllAirports: false, defaultAirportColor: '#ff3b3b', extensionEnabled: true }, ({ groups, assignments, showAllAirports, defaultAirportColor, extensionEnabled }) => {
    document.documentElement.dataset.fr24groups             = JSON.stringify(groups);
    document.documentElement.dataset.fr24assignments        = JSON.stringify(assignments);
    document.documentElement.dataset.fr24showallair         = showAllAirports ? '1' : '';
    document.documentElement.dataset.fr24defaultairportcolor = defaultAirportColor;
    document.documentElement.dataset.fr24enabled            = extensionEnabled ? '1' : '';
  });
}
pushConfig();
chrome.storage.onChanged.addListener(pushConfig);
