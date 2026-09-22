(() => {
  const out = [];
  const el = document.elementFromPoint(196, 400);
  const chain = [];
  let n = el;
  while (n && chain.length < 8) {
    const cs = getComputedStyle(n);
    chain.push({
      tag: n.tagName + (n.id ? '#' + n.id : '') + (n.className && typeof n.className === 'string' ? '.' + n.className.split(' ').slice(0, 2).join('.') : ''),
      touchAction: cs.touchAction, overflowY: cs.overflowY, overflow: cs.overflow
    });
    n = n.parentElement;
  }
  out.push('触点(196,400) 命中元素: ' + (el ? el.tagName + '#' + el.id + '.' + el.className : 'null'));
  out.push('祖先链上的 touch-action / overflow:');
  chain.forEach((c) => out.push('  ' + c.tag + '  touch-action=' + c.touchAction + '  overflowY=' + c.overflowY));
  out.push('');
  out.push('style.css 里 touch-action 是否加载到: ' + getComputedStyle(document.getElementById('stage')).touchAction);
  // 看看 vendor 的 xterm.css 有没有相关规则
  const sheets = [...document.styleSheets].map((s) => s.href || '(inline)');
  out.push('样式表: ' + JSON.stringify(sheets));
  return out.join('\n');
})()
