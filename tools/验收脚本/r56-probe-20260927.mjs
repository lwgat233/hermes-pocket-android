/* R56：会话页读数探针
 * ACTION=ui      面板/抽屉状态 + ☰ 坐标
 * ACTION=drawer  抽屉栏目项（文字 + 设备坐标）
 * ACTION=rows    会话页（#tab-sessions）行与分组原文
 */
export default {
  name: 'r56-probe',
  check: async (page) => {
    const action = process.env.ACTION || 'rows';
    await page.waitForTimeout(400);
    const DEV = 'const SX=1080/393, SY=2138/778; const dev=(el)=>{const r=el.getBoundingClientRect();return {x:Math.round((r.x+r.width/2)*SX), y:Math.round(136+(r.y+r.height/2)*SY), w:Math.round(r.width), h:Math.round(r.height)};};';
    if (action === 'ui') return page.evaluate(`(()=>{${DEV}
      const ov=document.getElementById('overlay'), dr=document.getElementById('drawer');
      const vis=(e)=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0;};
      return { board: (window.HP.App||{}).board||null, view: window.HP.Talk?window.HP.Talk.view:null,
        overlayShown: getComputedStyle(ov).display!=='none', drawerShown: getComputedStyle(dr).display!=='none'||String(dr.className).includes('show'),
        btnPanel: dev(document.getElementById('btn-panel')), btnKeys: dev(document.getElementById('btn-keys')),
        sessionsTabRows: document.querySelectorAll('#tab-sessions .card, #tab-sessions li, #tab-sessions tr').length,
        topbar: document.getElementById('tb-title').textContent+' / '+document.getElementById('tb-badge').textContent };
    })()`);
    if (action === 'drawer') return page.evaluate(`(()=>{${DEV}
      const dr=document.getElementById('drawer');
      const items=[...document.querySelectorAll('#dw-body *')].filter(e=>e.children.length===0&&e.innerText.trim());
      return { drawerClass: String(dr.className), text: dr.innerText.replace(/\\n/g,'|').slice(0,300),
        items: items.map(e=>({t:e.innerText.trim().slice(0,16), cls:String(e.className), ...dev(e)})) };
    })()`);
    return page.evaluate(`(()=>{${DEV}
      const el=document.getElementById('tab-sessions');
      const rows=[...document.querySelectorAll('#tab-sessions .card, #tab-sessions li, #tab-sessions .srow, #tab-sessions tr')].filter(e=>e.getBoundingClientRect().height>0);
      return { tabOn: el?el.classList.contains('on'):null,
        text: el?el.innerText:null,
        html: el?el.innerHTML.slice(0,4000):null,
        rowCount: rows.length,
        rows: rows.map(e=>({t:e.innerText.replace(/\\n/g,' | '), cls:String(e.className), ...dev(e)})),
        headers: [...document.querySelectorAll('#tab-sessions h3, #tab-sessions h4, #tab-sessions .grp, #tab-sessions .group, #tab-sessions .hd')].map(e=>e.innerText.replace(/\\n/g,'/')),
        maidRows: rows.filter(e=>/女仆|home-?maid|home\\.maid/i.test(e.innerText)).map(e=>e.innerText.replace(/\\n/g,' | ')),
        proxyRow: (document.getElementById('tab-sessions').scrollHeight||0)+'/'+(document.getElementById('tab-sessions').clientHeight||0)
      };
    })()`);
  }
};
