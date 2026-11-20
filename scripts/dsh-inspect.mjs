const version = await (await fetch(process.env.DSH_CDP || 'http://127.0.0.1:9230/json/version')).json()
const ws = new WebSocket(version.webSocketDebuggerUrl)
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject })
let id = 0
const pending = new Map()
ws.onmessage = (event) => {
  const message = JSON.parse(event.data)
  if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id) }
}
function call(method, params = {}) {
  return new Promise((resolve) => { const next = ++id; pending.set(next, resolve); ws.send(JSON.stringify({ id: next, method, params })) })
}
console.log(JSON.stringify(await call('Runtime.evaluate', { expression: `JSON.stringify({url:location.href,title:document.title,style:!!document.querySelector('#dsh-meetscribe-styles'),overlay:!!document.querySelector('.ms-float'),buttons:[...document.querySelectorAll('button')].map(b=>b.getAttribute('title')||b.textContent?.trim()).filter(Boolean).slice(-25)})`, returnByValue: true }), null, 2))
ws.close()
