(function () {
  const CFG = window.BNDR_CONFIG || {}
  const support = CFG.SUPPORT_EMAIL || 'bndr.labs@gmail.com'
  const status = document.body.getAttribute('data-error-status') || '404'
  const correlation = (window.crypto && crypto.randomUUID)
    ? crypto.randomUUID()
    : `corr-${Date.now()}`
  const hash = correlation.replace(/-/g, '').slice(0, 4).toUpperCase()
  const code = `NAV-${status}-${hash}`
  const version = CFG.APP_VERSION || '3.2.0'
  const commit = CFG.BUILD_COMMIT || 'not-injected'
  const route = window.location.pathname || '/'
  const stamp = new Date().toISOString()
  const repair = `You are debugging BNDR VoiceEngine. Error ${code}, correlation ${correlation}, route ${route}, version ${commit}. Locate root cause in the codebase, fix it at the root, then run the full audit loop (test → fix → retest) until everything passes. Report the fix and the green results.`
  const body = [
    'BNDR VoiceEngine error report',
    `Code: ${code}`,
    `Correlation: ${correlation}`,
    `Route: ${route}`,
    `UTC: ${stamp}`,
    `Version: ${version} (${commit})`,
    `Browser: ${navigator.userAgent}`,
    '',
    repair
  ].join('\n').slice(0, 1480)

  const codeEl = document.getElementById('errorCode')
  if (codeEl) codeEl.textContent = code
  const copyEl = document.getElementById('errorCopy')
  if (copyEl) copyEl.value = body
  const addrEl = document.getElementById('supportAddress')
  if (addrEl) addrEl.textContent = support

  const reportBtn = document.getElementById('reportBtn')
  if (reportBtn) {
    reportBtn.addEventListener('click', function () {
      window.location.href = `mailto:${encodeURIComponent(support)}?subject=${encodeURIComponent(`[${code}] VoiceEngine error`)}&body=${encodeURIComponent(body)}`
    })
  }
  const copyBtn = document.getElementById('copyBtn')
  if (copyBtn) {
    copyBtn.addEventListener('click', async function () {
      try {
        await navigator.clipboard.writeText(body)
        copyBtn.textContent = 'Copied'
      } catch (_) {
        if (copyEl) {
          copyEl.focus()
          copyEl.select()
        }
      }
    })
  }
})()
