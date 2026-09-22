export default {
  name: 'debug: 设置页 DOM 状态',
  check: (page) => page.evaluate(() => {
    const st = document.getElementById('tab-settings');
    const hosts = document.getElementById('tab-hosts');
    return {
      settingsLen: st ? st.innerHTML.length : -1,
      settingsHead: st ? st.innerHTML.slice(0, 300) : '',
      hostsLen: hosts ? hosts.innerHTML.length : -1,
      prefInputs: document.querySelectorAll('[data-pref]').length,
      panelsLoaded: HP.Panels._loaded,
      panelsPrefs: Object.keys(HP.Panels.prefs || {}).length,
      overlayOpen: !!document.querySelector('#overlay.on'),
      hasNative: HP.hasNative(),
      transportAlive: HP.App.transport && HP.App.transport.alive,
      transportMode: HP.App.transport && HP.App.transport.mode
    };
  })
};
