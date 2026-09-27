/* 读 App 状态：主机清单 / 偏好 / 连接状态 / 密钥清单（只读，不改） */
export default {
  name: 'r47-app-state',
  check: async (page) => {
    await page.waitForTimeout(800);
    return page.evaluate(() => {
      const A = window.HP && window.HP.App;
      const prefs = (() => { try { return Object.assign({}, A.prefs); } catch (e) { return null; } })();
      const ls = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); ls[k] = (localStorage.getItem(k) || '').slice(0, 200); }
      const hosts = (() => { try { return (A.hosts || HP.Store && HP.Store.hosts) } catch (e) { return null; } })();
      return {
        title: document.title,
        hasApp: !!A,
        connected: !!(A && A.transport && A.transport.alive),
        sessionId: A ? A.sessionId : null,
        hostName: A && A.host ? (A.host.name || A.host.host) : null,
        hostKeys: A && A.host ? Object.keys(A.host) : null,
        host: A && A.host ? { name: A.host.name, host: A.host.host, hostname: A.host.hostname, port: A.host.port, user: A.host.user, keyId: A.host.keyId || A.host.key_id || null, startCmd: A.host.startCmd, hermesAttach: (A.host.hermesAttach || null) } : null,
        prefs,
        localStorageKeys: Object.keys(ls),
        hostsPanelHTML: (() => { const e = document.getElementById('tab-hosts'); return e ? e.innerText.slice(0, 600) : null; })(),
        keysPanelHTML: (() => { const e = document.getElementById('tab-keys'); return e ? e.innerText.slice(0, 500) : null; })(),
        statusBadge: (document.getElementById('tb-title') || {}).textContent,
        topbar: (document.getElementById('tb-stat') || {}).innerText,
        composerVisible: !document.getElementById('composer').classList.contains('hidden'),
        termRows: (() => { const t = document.getElementById('termsizer'); return t ? t.innerText.slice(-400) : null; })(),
        errors: (window.__errs || []).slice(0, 5)
      };
    });
  }
};
