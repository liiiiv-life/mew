import test from 'node:test'
import assert from 'node:assert/strict'
import { createCollabDom } from './collab-dom.ts'

test('headless document parsing keeps content without running inline code', async () => {
  const window = createCollabDom()
  try {
    const parsed = new window.DOMParser().parseFromString('<body><p>ordinary document</p><script>document.body.setAttribute("data-script-ran", "yes")</script></body>', 'text/html')
    assert.equal(parsed.querySelector('p')?.textContent, 'ordinary document')
    assert.equal(parsed.body.hasAttribute('data-script-ran'), false)
    window.document.write('<script>document.body.setAttribute("data-script-ran", "yes")</script>')
    assert.equal(window.document.body.hasAttribute('data-script-ran'), false)
  } finally {
    await window.happyDOM.close()
  }
})

test('headless document cannot fetch resources or navigate to another page', async () => {
  const window = createCollabDom()
  try {
    // A data URL keeps this check entirely in memory even if the resource guard regresses.
    await assert.rejects(window.fetch('data:text/plain,resource'), /Headless document network access is disabled/)
    const xhr = new window.XMLHttpRequest()
    let requestFailed = false
    xhr.onerror = () => { requestFailed = true }
    xhr.open('GET', 'data:text/plain,resource', false)
    xhr.send()
    assert.equal(requestFailed, true)
    assert.equal(xhr.status, 0)
    window.location.href = 'http://localhost/another-page'
    assert.equal(window.location.href, 'http://localhost/')
    window.document.body.innerHTML = '<iframe src="data:text/html,frame"></iframe>'
    assert.equal(window.document.querySelector('iframe')?.contentDocument?.body.textContent ?? '', '')
  } finally {
    await window.happyDOM.close()
  }
})
